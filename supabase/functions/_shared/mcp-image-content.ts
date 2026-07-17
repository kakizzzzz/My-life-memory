export type MemoryImageReference = {
  noteIds: string[];
  imageIndex: number;
  provider: string;
  bucket: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: number | null;
};

export type McpImageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

type DownloadedImage = {
  bytes: Uint8Array;
  mimeType?: string;
};

type ImageDownload = (
  reference: MemoryImageReference,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<DownloadedImage>;

type PreparedImage = {
  reference: MemoryImageReference;
  bytes: Uint8Array;
  mimeType: string;
};

type FailedImage = {
  path: string;
  noteIds: string[];
  reason: string;
};

const SAFE_STORAGE_PATH = /^[A-Za-z0-9_.\/-]{1,1024}$/;
const SUPPORTED_IMAGE_MIME = /^image\/(?:jpeg|png|webp|gif)$/i;

const normalizedMimeType = (value: string) => value.split(';', 1)[0].trim().toLowerCase();

export const isUserScopedMemoryImage = (
  reference: MemoryImageReference,
  userId: string,
) => {
  if (reference.provider !== 'supabase' || reference.bucket !== 'life-media') return false;
  if (!reference.path.startsWith(`${userId}/`) || !SAFE_STORAGE_PATH.test(reference.path)) return false;
  const segments = reference.path.split('/');
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
};

export const encodeStorageObjectPath = (path: string) => (
  path.split('/').map(segment => encodeURIComponent(segment)).join('/')
);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const reasonForError = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') return 'download_timeout';
  if (error instanceof Error) return error.message.slice(0, 180) || 'download_failed';
  return 'download_failed';
};

export const buildMcpImageContent = async ({
  userId,
  media,
  maxImages = 3,
  download,
  timeoutMs = 10_000,
  perImageMaxBytes = 2_500_000,
  totalMaxBytes = 8_000_000,
  concurrency = 2,
}: {
  userId: string;
  media: MemoryImageReference[];
  maxImages?: number;
  download: ImageDownload;
  timeoutMs?: number;
  perImageMaxBytes?: number;
  totalMaxBytes?: number;
  concurrency?: number;
}) => {
  const requestedLimit = Math.min(Math.max(Math.floor(maxImages), 1), 6);
  const deduplicated = new Map<string, MemoryImageReference>();
  const failures: FailedImage[] = [];

  media.forEach(reference => {
    const key = `${reference.bucket}/${reference.path}`;
    const existing = deduplicated.get(key);
    if (existing) {
      existing.noteIds = [...new Set([...existing.noteIds, ...reference.noteIds])];
      return;
    }
    if (!isUserScopedMemoryImage(reference, userId)) {
      failures.push({ path: reference.path, noteIds: reference.noteIds, reason: 'invalid_or_unscoped_reference' });
      return;
    }
    deduplicated.set(key, { ...reference, noteIds: [...new Set(reference.noteIds)] });
  });

  const candidates = [...deduplicated.values()].slice(0, requestedLimit);
  const prepared: Array<PreparedImage | null> = Array(candidates.length).fill(null);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < candidates.length) {
      const index = nextIndex;
      nextIndex += 1;
      const reference = candidates[index];
      const metadataMime = normalizedMimeType(reference.mimeType || '');
      if (reference.size > perImageMaxBytes) {
        failures.push({ path: reference.path, noteIds: reference.noteIds, reason: 'image_too_large' });
        continue;
      }
      if (metadataMime && !SUPPORTED_IMAGE_MIME.test(metadataMime)) {
        failures.push({ path: reference.path, noteIds: reference.noteIds, reason: 'unsupported_image_type' });
        continue;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await download(reference, controller.signal, perImageMaxBytes);
        if (result.bytes.byteLength > perImageMaxBytes) throw new Error('image_too_large');
        const mimeType = normalizedMimeType(result.mimeType || metadataMime || 'image/jpeg');
        if (!SUPPORTED_IMAGE_MIME.test(mimeType)) throw new Error('unsupported_image_type');
        prepared[index] = { reference, bytes: result.bytes, mimeType };
      } catch (error) {
        failures.push({ path: reference.path, noteIds: reference.noteIds, reason: reasonForError(error) });
      } finally {
        clearTimeout(timeout);
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, Math.floor(concurrency)), 2, Math.max(1, candidates.length)) },
    () => worker(),
  ));

  const accepted: PreparedImage[] = [];
  let totalBytes = 0;
  prepared.forEach(item => {
    if (!item) return;
    if (totalBytes + item.bytes.byteLength > totalMaxBytes) {
      failures.push({ path: item.reference.path, noteIds: item.reference.noteIds, reason: 'response_size_limit' });
      return;
    }
    totalBytes += item.bytes.byteLength;
    accepted.push(item);
  });

  const summary = {
    ok: true,
    source: 'my-life-memory-private-storage',
    count: accepted.length,
    requestedNoteCount: new Set(media.flatMap(item => item.noteIds)).size,
    availableImageCount: deduplicated.size,
    returnedImageCount: accepted.length,
    failedImageCount: failures.length,
    timestamp: new Date().toISOString(),
    images: accepted.map((item, index) => ({
      order: index + 1,
      noteIds: item.reference.noteIds,
      path: item.reference.path,
      mimeType: item.mimeType,
      size: item.bytes.byteLength,
      createdAt: item.reference.createdAt,
    })),
    failures,
    instruction: accepted.length === 0
      ? 'No image pixels were returned. Do not claim to have seen or analyzed any photo.'
      : 'Analyze only the returned image blocks. Do not infer visual details from image metadata alone.',
  };

  const content: McpImageContentBlock[] = [{
    type: 'text',
    text: JSON.stringify(summary, null, 2),
  }];
  accepted.forEach((item, index) => {
    content.push({
      type: 'text',
      text: `Image ${index + 1}; noteIds=${item.reference.noteIds.join(',')}; path=${item.reference.path}`,
    });
    content.push({
      type: 'image',
      data: bytesToBase64(item.bytes),
      mimeType: item.mimeType,
    });
  });

  return { content, summary };
};
