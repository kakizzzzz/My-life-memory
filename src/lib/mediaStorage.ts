import {
  createSessionScopedSupabaseClient,
  isCloudBackendEnabled,
  supabase,
} from './supabaseClient';
import { getCloudSyncStatus } from './cloudSyncStatus';

export const MEDIA_BUCKET = 'life-media';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const PENDING_MEDIA_DELETE_STORAGE_KEY_PREFIX = 'my-life-memory-pending-media-deletes-v1:';
const DEFERRED_MEDIA_DELETE_MS = 7 * 24 * 60 * 60 * 1000;
const ORPHAN_MEDIA_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredImageMetadata = {
  provider: 'supabase';
  bucket: string;
  key: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: number;
};

export type StoredImageUpload = {
  metadata: StoredImageMetadata | null;
  src: string;
};

export type MediaAccountScope = {
  userId: string;
  accessToken: string;
};

export type StoredImageDownloadFailureType = (
  'not-found' | 'permission' | 'timeout' | 'network' | 'server' | 'invalid' | 'unknown'
);

export class StoredImageDownloadError extends Error {
  failureType: StoredImageDownloadFailureType;
  status?: number;
  retryable: boolean;

  constructor(
    message: string,
    failureType: StoredImageDownloadFailureType,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'StoredImageDownloadError';
    this.failureType = failureType;
    this.status = options.status;
    this.retryable = options.retryable ?? ['timeout', 'network', 'server'].includes(failureType);
  }
}

type StorageDownloadResponse = {
  data: Blob | null;
  error: unknown;
};

export type StoredImageDownloadOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  allowSignedUrlFallback?: boolean;
  download?: (bucket: string, path: string) => Promise<StorageDownloadResponse>;
  createSignedUrl?: (metadata: StoredImageMetadata) => Promise<string>;
  fetch?: typeof fetch;
};

export type StoredImageBlobDownload = {
  blob: Blob;
  method: 'download' | 'signed-url';
};

type SignedUrlBatchItem = {
  error: string | null;
  path: string | null;
  signedUrl: string | null;
};

type SignedUrlBatchResponse = {
  data: SignedUrlBatchItem[] | null;
  error: unknown;
};

export type WarmStorageImageUrlsProgress = {
  completed: number;
  ready: number;
  total: number;
};

export type WarmStorageImageUrlsOptions = {
  batchSize?: number;
  maxConcurrentBatches?: number;
  fallbackConcurrency?: number;
  onBatchReady?: (progress: WarmStorageImageUrlsProgress) => void;
  createSignedUrls?: (bucket: string, paths: string[]) => Promise<SignedUrlBatchResponse>;
  createSignedUrl?: (metadata: StoredImageMetadata) => Promise<string>;
};

export type WarmStorageImageUrlsResult = WarmStorageImageUrlsProgress & {
  failed: number;
};

type PendingMediaDelete = StoredImageMetadata & {
  deleteAfter?: number;
  immediate?: boolean;
};

const signedUrlCache = new Map<string, { src: string; expiresAt: number }>();
const signedUrlRequestCache = new Map<string, Promise<string>>();
const signedUrlWarmInFlight = new Map<string, Promise<void>>();

export const isSupabaseMediaEnabled = Boolean(isCloudBackendEnabled && supabase);

export const captureMediaAccountScope = async (): Promise<MediaAccountScope | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const session = data.session;
  if (!session?.user?.id || !session.access_token) return null;
  return {
    userId: session.user.id,
    accessToken: session.access_token,
  };
};

export const requestCloudMediaMaintenance = () => {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => window.dispatchEvent(new Event('mlm:media-maintenance')), 1000);
};

const cacheKeyForMetadata = (metadata: Pick<StoredImageMetadata, 'bucket' | 'path'>) => (
  `${metadata.bucket}/${metadata.path}`
);

const sameStoredImage = (
  a: Pick<StoredImageMetadata, 'bucket' | 'path'>,
  b: Pick<StoredImageMetadata, 'bucket' | 'path'>
) => (
  cacheKeyForMetadata(a) === cacheKeyForMetadata(b)
);

const uniqueMetadata = <T extends StoredImageMetadata>(metadataList: T[]): T[] => (
  metadataList.filter((metadata, index, list) => (
    list.findIndex(item => sameStoredImage(item, metadata)) === index
  ))
);

const getPendingDeleteStorageKey = (userId: string) => (
  `${PENDING_MEDIA_DELETE_STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`
);

export const clearPendingMediaDeletionState = (userId: string) => {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(getPendingDeleteStorageKey(userId));
  } catch {
    // Server account deletion has already completed; local cleanup is best effort.
  }
};

const readPendingDeletes = (userId: string): PendingMediaDelete[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(getPendingDeleteStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((metadata): metadata is PendingMediaDelete => (
      metadata?.provider === 'supabase' &&
      typeof metadata.bucket === 'string' &&
      typeof metadata.path === 'string' &&
      metadata.path.length > 0
    ));
  } catch {
    return [];
  }
};

const writePendingDeletes = (userId: string, metadataList: PendingMediaDelete[]) => {
  if (typeof window === 'undefined') return;

  try {
    const uniqueList = uniqueMetadata(metadataList).filter(metadata => (
      metadata.path.startsWith(`${userId}/`)
    ));
    if (uniqueList.length === 0) {
      window.localStorage.removeItem(getPendingDeleteStorageKey(userId));
      return;
    }
    window.localStorage.setItem(getPendingDeleteStorageKey(userId), JSON.stringify(uniqueList));
  } catch {
    // Best effort. Storage cleanup will retry whenever pending metadata can be persisted again.
  }
};

const enqueueServerMediaDeletion = async (
  userId: string,
  metadata: PendingMediaDelete,
  client: NonNullable<typeof supabase> | null = supabase,
) => {
  if (!client || !metadata.path.startsWith(`${userId}/`)) return false;
  const deleteAfter = metadata.deleteAfter
    ?? (metadata.immediate ? Date.now() : metadata.createdAt + DEFERRED_MEDIA_DELETE_MS);

  try {
    const { error } = await client.rpc('enqueue_memory_media_deletion', {
      p_bucket: metadata.bucket || MEDIA_BUCKET,
      p_path: metadata.path,
      p_not_before: new Date(deleteAfter).toISOString(),
    });
    if (error) throw error;
    return true;
  } catch (error) {
    console.warn('Could not queue server-side media deletion:', error);
    return false;
  }
};

const queueImageDeletion = async (metadata: PendingMediaDelete) => {
  const userId = await getCurrentUserId().catch(() => '');
  if (!userId || !metadata.path.startsWith(`${userId}/`)) return false;

  if (await enqueueServerMediaDeletion(userId, metadata)) {
    writePendingDeletes(
      userId,
      readPendingDeletes(userId).filter(item => !sameStoredImage(item, metadata)),
    );
    return true;
  }

  writePendingDeletes(userId, [...readPendingDeletes(userId), metadata]);
  return true;
};

const removeQueuedImageDeletion = async (metadata: StoredImageMetadata) => {
  const userId = await getCurrentUserId().catch(() => '');
  if (!userId || !metadata.path.startsWith(`${userId}/`)) return;
  writePendingDeletes(userId, readPendingDeletes(userId).filter(item => !sameStoredImage(item, metadata)));
};

const safePart = (value?: string) => (
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'item'
);

const extensionFromMime = (mimeType?: string) => {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'jpg';
};

const getCurrentUserId = async () => {
  if (!supabase) return '';
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user?.id || '';
};

export const storagePlaceholderSrc = (metadata: StoredImageMetadata) => (
  `storage://${metadata.bucket}/${metadata.path}`
);

export const buildStorageImageSrc = (metadata?: StoredImageMetadata | null) => {
  if (!metadata?.path) return '';
  const cached = signedUrlCache.get(cacheKeyForMetadata(metadata));
  return cached && cached.expiresAt > Date.now() + SIGNED_URL_REFRESH_MARGIN_MS
    ? cached.src
    : storagePlaceholderSrc(metadata);
};

const cacheSignedImageUrl = (metadata: StoredImageMetadata, signedUrl: string) => {
  if (!signedUrl) return;
  signedUrlCache.set(cacheKeyForMetadata(metadata), {
    src: signedUrl,
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
  });
};

const createSignedImageUrlWithClient = async (
  metadata: StoredImageMetadata,
  client: NonNullable<typeof supabase>,
) => {
  if (!metadata.path) return '';
  const { data, error } = await client.storage
    .from(metadata.bucket || MEDIA_BUCKET)
    .createSignedUrl(metadata.path, SIGNED_URL_TTL_SECONDS);

  if (error) throw error;
  const signedUrl = data?.signedUrl || '';
  cacheSignedImageUrl(metadata, signedUrl);
  return signedUrl;
};

export const createSignedImageUrl = async (metadata: StoredImageMetadata) => {
  if (!supabase) return '';
  const cachedSrc = buildStorageImageSrc(metadata);
  if (cachedSrc && !cachedSrc.startsWith('storage://')) return cachedSrc;

  const key = cacheKeyForMetadata(metadata);
  const inFlight = signedUrlRequestCache.get(key);
  if (inFlight) return inFlight;

  const request = createSignedImageUrlWithClient(metadata, supabase)
    .finally(() => {
      if (signedUrlRequestCache.get(key) === request) signedUrlRequestCache.delete(key);
    });
  signedUrlRequestCache.set(key, request);
  return request;
};

const getErrorStatus = (error: unknown) => {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = Number(candidate.status ?? candidate.statusCode);
  return Number.isFinite(status) ? status : undefined;
};

const classifyStoredImageDownloadError = (error: unknown) => {
  if (error instanceof StoredImageDownloadError) return error;
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : String(error || 'Unknown image download error');
  const lowered = message.toLowerCase();

  if (status === 404 || /not found|does not exist/.test(lowered)) {
    return new StoredImageDownloadError(message, 'not-found', { status, retryable: false });
  }
  if (status === 401 || status === 403 || /unauthorized|forbidden|permission|row-level security/.test(lowered)) {
    return new StoredImageDownloadError(message, 'permission', { status, retryable: false });
  }
  if (status && status >= 500) {
    return new StoredImageDownloadError(message, 'server', { status, retryable: true });
  }
  if (/timeout|timed out|aborterror|aborted/.test(lowered)) {
    return new StoredImageDownloadError(message, 'timeout', { status, retryable: true });
  }
  if (error instanceof TypeError || /failed to fetch|network|load failed|connection/.test(lowered)) {
    return new StoredImageDownloadError(message, 'network', { status, retryable: true });
  }
  if (/not configured|missing|invalid path|empty path/.test(lowered)) {
    return new StoredImageDownloadError(message, 'invalid', { status, retryable: false });
  }
  return new StoredImageDownloadError(message, 'unknown', { status, retryable: false });
};

const withImageDownloadTimeout = async <T,>(
  operation: Promise<T>,
  timeoutMs: number,
  path: string,
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new StoredImageDownloadError(
        `Timed out while downloading ${path}`,
        'timeout',
        { retryable: true },
      ));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const waitForImageRetry = (delayMs: number) => (
  new Promise(resolve => setTimeout(resolve, delayMs))
);

const runImageDownloadWithRetries = async <T,>(
  operation: () => Promise<T>,
  maxRetries: number,
  retryDelayMs: number,
) => {
  let lastError: StoredImageDownloadError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = classifyStoredImageDownloadError(error);
      if (!lastError.retryable || attempt >= maxRetries) throw lastError;
      await waitForImageRetry(retryDelayMs * (attempt + 1));
    }
  }
  throw lastError || new StoredImageDownloadError('Image download failed', 'unknown');
};

export const downloadStoredImageBlob = async (
  metadata: StoredImageMetadata,
  options: StoredImageDownloadOptions = {},
): Promise<StoredImageBlobDownload> => {
  const bucket = metadata.bucket || MEDIA_BUCKET;
  const path = metadata.path;
  if (!path) throw new StoredImageDownloadError('Invalid empty path', 'invalid', { retryable: false });

  const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
  const maxRetries = Math.max(0, Math.min(2, options.maxRetries ?? 2));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const directDownload = options.download ?? (async (downloadBucket: string, downloadPath: string) => {
    if (!supabase) {
      throw new StoredImageDownloadError('Supabase Storage is not configured.', 'invalid', { retryable: false });
    }
    return supabase.storage.from(downloadBucket).download(downloadPath);
  });

  let directError: StoredImageDownloadError | null = null;
  try {
    const blob = await runImageDownloadWithRetries(async () => {
      const response = await withImageDownloadTimeout(
        directDownload(bucket, path),
        timeoutMs,
        path,
      );
      if (response.error) throw response.error;
      if (!(response.data instanceof Blob)) {
        throw new StoredImageDownloadError('Storage download returned no image data.', 'unknown');
      }
      return response.data;
    }, maxRetries, retryDelayMs);
    return { blob, method: 'download' };
  } catch (error) {
    directError = classifyStoredImageDownloadError(error);
  }

  const canUseFallback = (
    options.allowSignedUrlFallback !== false &&
    directError.failureType !== 'not-found' &&
    directError.failureType !== 'permission' &&
    directError.failureType !== 'invalid'
  );
  if (!canUseFallback) throw directError;

  const createSignedUrl = options.createSignedUrl ?? createSignedImageUrl;
  const fetchImpl = options.fetch ?? fetch;
  const fallbackRetries = directError.retryable ? 0 : maxRetries;
  try {
    const blob = await runImageDownloadWithRetries(async () => {
      const signedUrl = await withImageDownloadTimeout(createSignedUrl(metadata), timeoutMs, path);
      if (!signedUrl) {
        throw new StoredImageDownloadError('Signed image URL was empty.', 'invalid', { retryable: false });
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await withImageDownloadTimeout(
          fetchImpl(signedUrl, { signal: controller.signal }),
          timeoutMs,
          path,
        );
        if (!response.ok) {
          throw new StoredImageDownloadError(
            `HTTP ${response.status}`,
            response.status === 404
              ? 'not-found'
              : response.status === 401 || response.status === 403
                ? 'permission'
                : response.status >= 500
                  ? 'server'
                  : 'unknown',
            { status: response.status },
          );
        }
        return response.blob();
      } finally {
        clearTimeout(timeoutId);
      }
    }, fallbackRetries, retryDelayMs);
    return { blob, method: 'signed-url' };
  } catch (error) {
    throw classifyStoredImageDownloadError(error);
  }
};

const clampInteger = (value: number | undefined, fallback: number, minimum: number, maximum: number) => (
  Math.max(minimum, Math.min(maximum, Math.floor(value ?? fallback)))
);

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

export const warmStorageImageUrls = async (
  metadataList: StoredImageMetadata[],
  options: WarmStorageImageUrlsOptions = {},
): Promise<WarmStorageImageUrlsResult> => {
  const emptyResult = { completed: 0, ready: 0, total: 0, failed: 0 };
  if (metadataList.length === 0 || (!supabase && !options.createSignedUrls)) return emptyResult;

  const staleMetadata = uniqueMetadata(metadataList).filter(metadata => (
    metadata.provider === 'supabase' &&
    Boolean(metadata.path) &&
    buildStorageImageSrc(metadata).startsWith('storage://')
  ));
  if (staleMetadata.length === 0) return emptyResult;

  const total = staleMetadata.length;
  const batchSize = clampInteger(options.batchSize, 32, 1, 100);
  const maxConcurrentBatches = clampInteger(options.maxConcurrentBatches, 2, 1, 4);
  const fallbackConcurrency = clampInteger(options.fallbackConcurrency, 3, 1, 4);
  const createSignedUrls = options.createSignedUrls ?? (async (bucket: string, paths: string[]) => {
    if (!supabase) return { data: null, error: new Error('Supabase Storage is not configured.') };
    return supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  });
  const createSignedUrl = options.createSignedUrl ?? createSignedImageUrl;

  const pendingByBucket = new Map<string, StoredImageMetadata[]>();
  const promisesToMetadata = new Map<Promise<void>, StoredImageMetadata[]>();

  staleMetadata.forEach(metadata => {
    const key = cacheKeyForMetadata(metadata);
    const inFlight = signedUrlWarmInFlight.get(key);
    if (inFlight) {
      const current = promisesToMetadata.get(inFlight) || [];
      current.push(metadata);
      promisesToMetadata.set(inFlight, current);
      return;
    }

    const bucket = metadata.bucket || MEDIA_BUCKET;
    const bucketItems = pendingByBucket.get(bucket) || [];
    bucketItems.push(metadata);
    pendingByBucket.set(bucket, bucketItems);
  });

  const batches: StoredImageMetadata[][] = [];
  pendingByBucket.forEach(bucketItems => {
    for (let index = 0; index < bucketItems.length; index += batchSize) {
      batches.push(bucketItems.slice(index, index + batchSize));
    }
  });

  type BatchTask = {
    metadata: StoredImageMetadata[];
    promise: Promise<void>;
    resolve: () => void;
  };

  const batchTasks: BatchTask[] = batches.map(batch => {
    let resolve = () => {};
    const promise = new Promise<void>(complete => {
      resolve = complete;
    });
    batch.forEach(metadata => signedUrlWarmInFlight.set(cacheKeyForMetadata(metadata), promise));
    promisesToMetadata.set(promise, batch);
    return { metadata: batch, promise, resolve };
  });

  let completed = 0;
  let ready = 0;
  const notifications = Array.from(promisesToMetadata.entries()).map(async ([promise, metadata]) => {
    await promise;
    completed += metadata.length;
    ready += metadata.filter(item => !buildStorageImageSrc(item).startsWith('storage://')).length;
    options.onBatchReady?.({ completed, ready, total });
  });

  const warmBatch = async (batch: StoredImageMetadata[]) => {
    const bucket = batch[0]?.bucket || MEDIA_BUCKET;
    let unresolved = batch;
    try {
      const response = await createSignedUrls(bucket, batch.map(metadata => metadata.path));
      if (response.error) throw response.error;

      const resultsByPath = new Map<string, SignedUrlBatchItem>(
        (response.data || [])
          .filter(result => Boolean(result.path))
          .map(result => [result.path!, result]),
      );
      unresolved = batch.filter(metadata => {
        const result = resultsByPath.get(metadata.path);
        if (!result?.signedUrl || result.error) return true;
        cacheSignedImageUrl(metadata, result.signedUrl);
        return false;
      });
    } catch (error) {
      console.warn(`Could not warm signed image URL batch for ${bucket}:`, error);
    }

    if (unresolved.length === 0) return;
    await runWithConcurrency(unresolved, fallbackConcurrency, async metadata => {
      try {
        const signedUrl = await createSignedUrl(metadata);
        cacheSignedImageUrl(metadata, signedUrl);
      } catch (error) {
        console.warn(`Could not warm signed image URL for ${metadata.path}:`, error);
      }
    });
  };

  let nextBatchIndex = 0;
  const workers = Array.from(
    { length: Math.min(maxConcurrentBatches, batchTasks.length) },
    async () => {
      while (nextBatchIndex < batchTasks.length) {
        const taskIndex = nextBatchIndex;
        nextBatchIndex += 1;
        const task = batchTasks[taskIndex];
        try {
          await warmBatch(task.metadata);
        } finally {
          task.metadata.forEach(metadata => {
            const key = cacheKeyForMetadata(metadata);
            if (signedUrlWarmInFlight.get(key) === task.promise) signedUrlWarmInFlight.delete(key);
          });
          task.resolve();
        }
      }
    },
  );

  await Promise.all([...workers, ...notifications]);
  return {
    completed,
    ready,
    total,
    failed: Math.max(0, total - ready),
  };
};

export const uploadImageToStorage = async (
  file: File | Blob,
  options: {
    noteId?: string;
    imageId?: string;
    folder?: 'notes' | 'avatars';
    fileName?: string;
    accountScope?: MediaAccountScope;
  } = {}
): Promise<StoredImageUpload> => {
  if (!isSupabaseMediaEnabled || !supabase) {
    throw new Error('Supabase Storage is not configured.');
  }

  const scopedClient = options.accountScope
    ? createSessionScopedSupabaseClient(options.accountScope.accessToken)
    : supabase;
  if (!scopedClient) throw new Error('The media upload session is unavailable.');

  const userId = options.accountScope?.userId || await getCurrentUserId();
  if (!userId) throw new Error('No active Supabase user for media upload.');

  const imageId = safePart(options.imageId || crypto.randomUUID());
  const folder = safePart(options.folder || 'notes');
  const noteId = safePart(options.noteId || 'general');
  const mimeType = file.type || 'image/jpeg';
  const extension = extensionFromMime(mimeType);
  const path = `${userId}/${folder}/${noteId}/${imageId}.${extension}`;

  const { error } = await scopedClient.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw error;

  const metadata: StoredImageMetadata = {
    provider: 'supabase',
    bucket: MEDIA_BUCKET,
    key: path,
    path,
    mimeType,
    size: file.size,
    createdAt: Date.now(),
  };

  let src = storagePlaceholderSrc(metadata);
  try {
    src = await createSignedImageUrlWithClient(metadata, scopedClient) || src;
  } catch (error) {
    // The upload already succeeded. Return its metadata so the caller can keep
    // or clean up the object instead of losing track of an orphaned file.
    console.warn('Could not create a signed URL for the uploaded image:', error);
  }
  return { metadata, src };
};

export const discardUploadedImageForScope = async (
  metadata: StoredImageMetadata,
  accountScope: MediaAccountScope,
) => {
  if (
    metadata.provider !== 'supabase'
    || !metadata.path.startsWith(`${accountScope.userId}/`)
  ) return false;

  const pendingDelete: PendingMediaDelete = {
    ...metadata,
    immediate: true,
    deleteAfter: Date.now(),
  };
  writePendingDeletes(accountScope.userId, [
    ...readPendingDeletes(accountScope.userId),
    pendingDelete,
  ]);

  const scopedClient = createSessionScopedSupabaseClient(accountScope.accessToken);
  if (!scopedClient) return false;

  try {
    const { error } = await scopedClient.storage
      .from(metadata.bucket || MEDIA_BUCKET)
      .remove([metadata.path]);
    if (error) throw error;
    signedUrlCache.delete(cacheKeyForMetadata(metadata));
    writePendingDeletes(
      accountScope.userId,
      readPendingDeletes(accountScope.userId).filter(item => !sameStoredImage(item, metadata)),
    );
    return true;
  } catch (removeError) {
    try {
      const { error } = await scopedClient.rpc('enqueue_memory_media_deletion', {
        p_bucket: metadata.bucket || MEDIA_BUCKET,
        p_path: metadata.path,
        p_not_before: new Date().toISOString(),
      });
      if (error) throw error;
      writePendingDeletes(
        accountScope.userId,
        readPendingDeletes(accountScope.userId).filter(item => !sameStoredImage(item, metadata)),
      );
      return true;
    } catch (queueError) {
      console.warn('Could not clean up a stale media upload:', removeError, queueError);
      return false;
    }
  }
};

export const deleteImageFromStorage = async (metadata: StoredImageMetadata) => {
  if (!supabase || metadata.provider !== 'supabase' || !metadata.path) return true;

  return deleteImageFromStorageWithClient(metadata, supabase);
};

const deleteImageFromStorageWithClient = async (
  metadata: StoredImageMetadata,
  client: NonNullable<typeof supabase>,
) => {
  if (metadata.provider !== 'supabase' || !metadata.path) return true;

  try {
    const { error } = await client.storage
      .from(metadata.bucket || MEDIA_BUCKET)
      .remove([metadata.path]);

    if (error) {
      console.warn('Could not delete Supabase Storage image:', error);
      return false;
    }

    signedUrlCache.delete(cacheKeyForMetadata(metadata));
    return true;
  } catch (error) {
    console.warn('Could not delete Supabase Storage image:', error);
    return false;
  }
};

export const deleteImageFromStorageReliably = async (metadata: StoredImageMetadata) => {
  const deleted = await deleteImageFromStorage(metadata);
  if (deleted) {
    await removeQueuedImageDeletion(metadata);
  } else {
    await queueImageDeletion({ ...metadata, immediate: true });
  }
  return deleted;
};

export const scheduleImageDeletion = async (
  metadata: StoredImageMetadata,
  delayMs = DEFERRED_MEDIA_DELETE_MS
) => {
  const userId = await getCurrentUserId().catch(() => '');
  if (!userId || !metadata.path.startsWith(`${userId}/`)) return false;
  const queued = await queueImageDeletion({
    ...metadata,
    deleteAfter: Date.now() + Math.max(0, delayMs),
  });
  requestCloudMediaMaintenance();
  return queued;
};

export const retryPendingImageDeletions = async (
  referencedMetadata: StoredImageMetadata[] = [],
  options: {
    accountScope?: MediaAccountScope;
    allowDeferredDeletes?: boolean;
  } = {},
) => {
  const client = options.accountScope
    ? createSessionScopedSupabaseClient(options.accountScope.accessToken)
    : supabase;
  const userId = options.accountScope?.userId || await getCurrentUserId().catch(() => '');
  if (!client || !userId) return;
  const pendingDeletes = uniqueMetadata(readPendingDeletes(userId));
  if (pendingDeletes.length === 0) return;

  const referencedPaths = new Set(
    uniqueMetadata(referencedMetadata)
      .filter(metadata => metadata.path.startsWith(`${userId}/`))
      .map(metadata => metadata.path)
  );

  const remainingDeletes: PendingMediaDelete[] = [];
  for (const metadata of pendingDeletes) {
    if (referencedPaths.has(metadata.path)) {
      remainingDeletes.push(metadata);
      continue;
    }
    const allowDeferredDeletes = options.allowDeferredDeletes
      ?? getCloudSyncStatus().phase === 'synced';
    if (!metadata.immediate && !allowDeferredDeletes) {
      remainingDeletes.push(metadata);
      continue;
    }
    const deleteAfter = metadata.deleteAfter ?? metadata.createdAt + DEFERRED_MEDIA_DELETE_MS;
    if (!metadata.immediate && deleteAfter > Date.now()) {
      const queued = await enqueueServerMediaDeletion(userId, metadata, client);
      if (!queued) remainingDeletes.push(metadata);
      continue;
    }
    const deleted = await deleteImageFromStorageWithClient(metadata, client);
    if (!deleted) {
      const queued = await enqueueServerMediaDeletion(userId, {
        ...metadata,
        immediate: true,
        deleteAfter: Date.now(),
      }, client);
      if (!queued) remainingDeletes.push(metadata);
    }
  }
  writePendingDeletes(userId, remainingDeletes);
};

const listStorageFilesRecursively = async (
  folder: string,
  client: NonNullable<typeof supabase>,
): Promise<Array<{
  path: string;
  createdAt: number;
  mimeType: string;
  size: number;
}>> => {
  const output: Array<{ path: string; createdAt: number; mimeType: string; size: number }> = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client.storage.from(MEDIA_BUCKET).list(folder, {
      limit: 100,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const entries = data || [];
    for (const entry of entries) {
      const path = `${folder}/${entry.name}`;
      if (!entry.id) {
        output.push(...await listStorageFilesRecursively(path, client));
        continue;
      }
      output.push({
        path,
        createdAt: Date.parse(entry.created_at || entry.updated_at || '') || Date.now(),
        mimeType: String(entry.metadata?.mimetype || 'image/jpeg'),
        size: Number(entry.metadata?.size || 0),
      });
    }
    if (entries.length < 100) break;
    offset += entries.length;
  }
  return output;
};

export const cleanupUnreferencedStorageImages = async (
  referencedMetadata: StoredImageMetadata[],
  graceMs = ORPHAN_MEDIA_GRACE_MS,
  accountScope?: MediaAccountScope,
) => {
  const client = accountScope
    ? createSessionScopedSupabaseClient(accountScope.accessToken)
    : supabase;
  const userId = accountScope?.userId || await getCurrentUserId().catch(() => '');
  if (!client || !userId) return { scanned: 0, deleted: 0 };

  const referencedPaths = new Set(
    uniqueMetadata(referencedMetadata)
      .filter(metadata => metadata.path.startsWith(`${userId}/`))
      .map(metadata => metadata.path)
  );
  const files = await listStorageFilesRecursively(userId, client);
  const cutoff = Date.now() - Math.max(0, graceMs);
  const orphanedFiles = files.filter(file => file.createdAt < cutoff && !referencedPaths.has(file.path));

  let deleted = 0;
  for (const file of orphanedFiles) {
    const metadata: StoredImageMetadata = {
      provider: 'supabase',
      bucket: MEDIA_BUCKET,
      key: file.path,
      path: file.path,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
    };
    const didDelete = await deleteImageFromStorageWithClient(metadata, client);
    if (!didDelete) {
      await enqueueServerMediaDeletion(userId, {
        ...metadata,
        immediate: true,
        deleteAfter: Date.now(),
      }, client);
    }
    if (didDelete) deleted += 1;
  }
  return { scanned: files.length, deleted };
};

export const imageMetadataFromElement = (element: Element | null): StoredImageMetadata | null => {
  const image = element?.matches('img') ? element as HTMLImageElement : element?.querySelector('img');
  if (!image || image.dataset.mediaProvider !== 'supabase' || !image.dataset.mediaPath) return null;

  const bucket = image.dataset.mediaBucket || MEDIA_BUCKET;
  const path = image.dataset.mediaPath;
  return {
    provider: 'supabase',
    bucket,
    key: image.dataset.mediaKey || path,
    path,
    mimeType: image.dataset.mediaMimeType || 'image/jpeg',
    size: Number(image.dataset.mediaSize || 0),
    createdAt: Number(image.dataset.mediaCreatedAt || Date.now()),
  };
};

export const metadataAttrs = (metadata: StoredImageMetadata) => ({
  'data-media-provider': metadata.provider,
  'data-media-bucket': metadata.bucket,
  'data-media-key': metadata.key,
  'data-media-path': metadata.path,
  'data-media-mime-type': metadata.mimeType,
  'data-media-size': String(metadata.size),
  'data-media-created-at': String(metadata.createdAt),
});

const attrsToString = (attrs: Record<string, string>) => (
  Object.entries(attrs)
    .map(([key, value]) => `${key}="${value.replace(/"/g, '&quot;')}"`)
    .join(' ')
);

export const storageImageAttrsHtml = (metadata: StoredImageMetadata) => attrsToString(metadataAttrs(metadata));

export const hydrateStorageMediaHtml = (html: string) => {
  if (!html || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLImageElement>('img[data-media-provider="supabase"][data-media-path]').forEach(image => {
    const metadata = imageMetadataFromElement(image);
    if (!metadata) return;
    image.src = buildStorageImageSrc(metadata);
  });
  return container.innerHTML;
};

export const dehydrateStorageMediaHtml = (html: string) => {
  if (!html || typeof document === 'undefined') return html;
  const container = document.createElement('div');
  container.innerHTML = html;
  container.querySelectorAll<HTMLElement>('[data-note-tail="true"]').forEach(tail => {
    if (!tail.textContent?.trim() && !tail.querySelector('img')) tail.remove();
  });
  container.querySelectorAll<HTMLImageElement>('img[data-media-provider="supabase"][data-media-path]').forEach(image => {
    const metadata = imageMetadataFromElement(image);
    if (!metadata) return;
    image.src = storagePlaceholderSrc(metadata);
  });
  return container.innerHTML;
};
