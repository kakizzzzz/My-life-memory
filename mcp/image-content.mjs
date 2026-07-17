const SAFE_STORAGE_PATH = /^[A-Za-z0-9_.\/-]{1,1024}$/;
const SUPPORTED_IMAGE_MIME = /^image\/(?:jpeg|png|webp|gif)$/i;

export const encodeStorageObjectPath = path => (
  path.split('/').map(segment => encodeURIComponent(segment)).join('/')
);

const isUserScopedImage = (reference, userId) => {
  if (reference?.provider !== 'supabase' || reference?.bucket !== 'life-media') return false;
  if (!reference.path?.startsWith(`${userId}/`) || !SAFE_STORAGE_PATH.test(reference.path)) return false;
  return reference.path.split('/').every(segment => segment && segment !== '.' && segment !== '..');
};

const normalizeMime = value => String(value || '').split(';', 1)[0].trim().toLowerCase();

export const buildImageToolResult = async ({
  userId,
  media,
  maxImages,
  download,
  timeoutMs = 10_000,
  perImageMaxBytes = 2_500_000,
  totalMaxBytes = 8_000_000,
}) => {
  const failures = [];
  const unique = new Map();
  media.forEach(reference => {
    const key = `${reference?.bucket}/${reference?.path}`;
    const existing = unique.get(key);
    if (existing) {
      existing.noteIds = [...new Set([...existing.noteIds, ...(reference.noteIds || [])])];
    } else if (isUserScopedImage(reference, userId)) {
      unique.set(key, { ...reference, noteIds: [...new Set(reference.noteIds || [])] });
    } else {
      failures.push({ path: reference?.path || '', noteIds: reference?.noteIds || [], reason: 'invalid_or_unscoped_reference' });
    }
  });

  const candidates = [...unique.values()].slice(0, Math.min(Math.max(Number(maxImages) || 3, 1), 6));
  const prepared = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      const reference = candidates[index];
      const metadataMime = normalizeMime(reference.mimeType);
      if (Number(reference.size) > perImageMaxBytes || (metadataMime && !SUPPORTED_IMAGE_MIME.test(metadataMime))) {
        failures.push({ path: reference.path, noteIds: reference.noteIds, reason: Number(reference.size) > perImageMaxBytes ? 'image_too_large' : 'unsupported_image_type' });
        continue;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await download(reference, controller.signal, perImageMaxBytes);
        const mimeType = normalizeMime(result.mimeType || metadataMime || 'image/jpeg');
        if (result.bytes.byteLength > perImageMaxBytes) throw new Error('image_too_large');
        if (!SUPPORTED_IMAGE_MIME.test(mimeType)) throw new Error('unsupported_image_type');
        prepared[index] = { reference, bytes: result.bytes, mimeType };
      } catch (error) {
        failures.push({
          path: reference.path,
          noteIds: reference.noteIds,
          reason: error?.name === 'AbortError' ? 'download_timeout' : String(error?.message || 'download_failed').slice(0, 180),
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, Math.max(1, candidates.length)) }, () => worker()));

  const accepted = [];
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
    availableImageCount: unique.size,
    returnedImageCount: accepted.length,
    failedImageCount: failures.length,
    timestamp: new Date().toISOString(),
    images: accepted.map((item, index) => ({
      order: index + 1,
      noteIds: item.reference.noteIds,
      path: item.reference.path,
      mimeType: item.mimeType,
      size: item.bytes.byteLength,
      createdAt: item.reference.createdAt || null,
    })),
    failures,
    instruction: accepted.length
      ? 'Analyze only the returned image blocks. Do not infer visual details from image metadata alone.'
      : 'No image pixels were returned. Do not claim to have seen or analyzed any photo.',
  };
  const content = [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
  accepted.forEach((item, index) => {
    content.push({ type: 'text', text: `Image ${index + 1}; noteIds=${item.reference.noteIds.join(',')}; path=${item.reference.path}` });
    content.push({ type: 'image', data: Buffer.from(item.bytes).toString('base64'), mimeType: item.mimeType });
  });
  return { content };
};
