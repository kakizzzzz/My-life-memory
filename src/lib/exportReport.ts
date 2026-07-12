import type { NoteData } from '../types/app';
import {
  downloadStoredImageBlob,
  storagePlaceholderSrc,
  StoredImageDownloadError,
  type StoredImageDownloadFailureType,
  type StoredImageDownloadOptions,
  type StoredImageMetadata,
} from './mediaStorage';
import {
  escapeHtml,
  extractImagesFromHtml,
  getLegacyNoteImages,
  getStoredImagesFromNote,
} from './noteHtmlUtils';

export type ExportedImageData = {
  source: string;
  provider: 'supabase' | 'inline' | 'external';
  bucket?: string;
  key?: string;
  path?: string;
  src?: string;
  mimeType?: string;
  size?: number;
  createdAt?: number;
  dataUrl?: string;
  exportError?: string;
  exportErrorType?: ExportImageFailureType;
};

export type ExportImageFailureType = StoredImageDownloadFailureType;

export type ExportImageFailure = {
  key: string;
  path: string;
  type: ExportImageFailureType;
  message: string;
};

export type ExportImageTask = {
  key: string;
  dedupeKey: string;
  source: string;
  kind: 'stored' | 'source';
  metadata?: StoredImageMetadata;
  src?: string;
};

export type ExportImageTaskProgress = {
  completed: number;
  total: number;
};

export type ExportImageTaskResult = {
  results: Map<string, ExportedImageData | null>;
  failures: ExportImageFailure[];
  total: number;
};

type ExportSourceOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  fetch?: typeof fetch;
};

type ExportImageTaskOptions = {
  concurrency?: number;
  storedImageOptions?: StoredImageDownloadOptions;
  sourceOptions?: ExportSourceOptions;
  onProgress?: (progress: ExportImageTaskProgress) => void;
  resolveTask?: (task: ExportImageTask) => Promise<ExportedImageData | null>;
};

class ExportSourceError extends Error {
  failureType: ExportImageFailureType;
  retryable: boolean;

  constructor(message: string, failureType: ExportImageFailureType, retryable = false) {
    super(message);
    this.name = 'ExportSourceError';
    this.failureType = failureType;
    this.retryable = retryable;
  }
}

export const blobToDataUrl = (blob: Blob) => {
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  });
};

const getDataUrlMimeType = (dataUrl: string) => (
  dataUrl.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream'
);

const getDataUrlApproxSize = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.max(0, Math.floor((base64.length * 3) / 4));
};

const classifySourceError = (error: unknown) => {
  if (error instanceof ExportSourceError) return error;
  if (error instanceof StoredImageDownloadError) {
    return new ExportSourceError(error.message, error.failureType, error.retryable);
  }
  const message = error instanceof Error ? error.message : String(error || 'Unknown image error');
  const lowered = message.toLowerCase();
  if (/timeout|timed out|aborterror|aborted/.test(lowered)) {
    return new ExportSourceError(message, 'timeout', true);
  }
  if (error instanceof TypeError || /failed to fetch|network|load failed|connection/.test(lowered)) {
    return new ExportSourceError(message, 'network', true);
  }
  return new ExportSourceError(message, 'unknown');
};

const waitForRetry = (delayMs: number) => new Promise(resolve => setTimeout(resolve, delayMs));

const fetchImageAsDataUrl = async (src: string, options: ExportSourceOptions = {}) => {
  if (src.startsWith('data:')) {
    return {
      dataUrl: src,
      mimeType: getDataUrlMimeType(src),
      size: getDataUrlApproxSize(src),
    };
  }

  const timeoutMs = Math.max(1, options.timeoutMs ?? 15_000);
  const maxRetries = Math.max(0, Math.min(2, options.maxRetries ?? 2));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const fetchImpl = options.fetch ?? fetch;
  let lastError: ExportSourceError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        fetchImpl(src, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new ExportSourceError(`Timed out while downloading image source`, 'timeout', true));
          }, timeoutMs);
        }),
      ]);
      if (!response.ok) {
        const type: ExportImageFailureType = response.status === 404
          ? 'not-found'
          : response.status === 401 || response.status === 403
            ? 'permission'
            : response.status >= 500
              ? 'server'
              : 'unknown';
        throw new ExportSourceError(`HTTP ${response.status}`, type, type === 'server');
      }
      const blob = await response.blob();
      return {
        dataUrl: await blobToDataUrl(blob),
        mimeType: blob.type || 'image/jpeg',
        size: blob.size,
      };
    } catch (error) {
      lastError = classifySourceError(error);
      if (!lastError.retryable || attempt >= maxRetries) throw lastError;
      await waitForRetry(retryDelayMs * (attempt + 1));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  throw lastError || new ExportSourceError('Image download failed', 'unknown');
};

export const exportImageSource = async (
  src: string,
  source: string,
  options: ExportSourceOptions = {},
): Promise<ExportedImageData | null> => {
  if (!src || src.startsWith('storage://')) return null;

  try {
    const imageData = await fetchImageAsDataUrl(src, options);
    return {
      source,
      provider: src.startsWith('data:') ? 'inline' : 'external',
      src,
      ...imageData,
    };
  } catch (error) {
    return {
      source,
      provider: 'external',
      src,
      exportError: error instanceof Error ? error.message : String(error),
      exportErrorType: classifySourceError(error).failureType,
    };
  }
};

export const exportStoredImage = async (
  metadata: StoredImageMetadata,
  source: string,
  options: StoredImageDownloadOptions = {},
): Promise<ExportedImageData> => {
  const baseImage = {
    source,
    provider: 'supabase' as const,
    bucket: metadata.bucket,
    key: metadata.key,
    path: metadata.path,
    mimeType: metadata.mimeType,
    size: metadata.size,
    createdAt: metadata.createdAt,
  };

  try {
    const { blob } = await downloadStoredImageBlob(metadata, options);
    return {
      ...baseImage,
      src: storagePlaceholderSrc(metadata),
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || metadata.mimeType || 'image/jpeg',
      size: blob.size,
    };
  } catch (error) {
    const classified = error instanceof StoredImageDownloadError
      ? error
      : new StoredImageDownloadError(
          error instanceof Error ? error.message : String(error),
          'unknown',
        );
    return {
      ...baseImage,
      src: storagePlaceholderSrc(metadata),
      exportError: classified.message,
      exportErrorType: classified.failureType,
    };
  }
};

export const storedExportImageKey = (metadata: Pick<StoredImageMetadata, 'bucket' | 'path'>) => (
  `storage:${metadata.bucket}/${metadata.path}`
);

export const sourceExportImageKey = (src: string) => {
  let hash = 1469598103934665603n;
  for (let index = 0; index < src.length; index += 1) {
    hash ^= BigInt(src.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return `source:${src.length}:${hash.toString(16)}`;
};

export const createStoredExportImageTask = (
  metadata: StoredImageMetadata,
  source: string,
): ExportImageTask => {
  const key = storedExportImageKey(metadata);
  return { key, dedupeKey: key, source, kind: 'stored', metadata };
};

export const createSourceExportImageTask = (src: string, source: string): ExportImageTask => ({
  key: sourceExportImageKey(src),
  dedupeKey: src,
  source,
  kind: 'source',
  src,
});

const defaultResolveExportImageTask = (
  task: ExportImageTask,
  options: ExportImageTaskOptions,
) => {
  if (task.kind === 'stored' && task.metadata) {
    return exportStoredImage(task.metadata, task.source, options.storedImageOptions);
  }
  return exportImageSource(task.src || '', task.source, options.sourceOptions);
};

export const exportImageTasks = async (
  tasks: ExportImageTask[],
  options: ExportImageTaskOptions = {},
): Promise<ExportImageTaskResult> => {
  const uniqueTasks = Array.from(new Map(tasks.map(task => [task.dedupeKey, task])).values());
  const concurrency = Math.max(1, Math.min(3, options.concurrency ?? 3));
  const results = new Map<string, ExportedImageData | null>();
  const failures: ExportImageFailure[] = [];
  let nextIndex = 0;
  let completed = 0;
  const resolveTask = options.resolveTask ?? (task => defaultResolveExportImageTask(task, options));

  options.onProgress?.({ completed: 0, total: uniqueTasks.length });
  const worker = async () => {
    while (nextIndex < uniqueTasks.length) {
      const task = uniqueTasks[nextIndex];
      nextIndex += 1;
      let result: ExportedImageData | null;
      try {
        result = await resolveTask(task);
      } catch (error) {
        const classified = classifySourceError(error);
        result = {
          source: task.source,
          provider: task.kind === 'stored' ? 'supabase' : 'external',
          bucket: task.metadata?.bucket,
          key: task.metadata?.key,
          path: task.metadata?.path,
          src: task.kind === 'stored' && task.metadata
            ? storagePlaceholderSrc(task.metadata)
            : task.src,
          exportError: classified.message,
          exportErrorType: classified.failureType,
        };
      }

      results.set(task.dedupeKey, result);
      if (result?.exportError) {
        const failure = {
          key: task.key,
          path: task.metadata?.path || task.source,
          type: result.exportErrorType || 'unknown',
          message: result.exportError,
        } satisfies ExportImageFailure;
        failures.push(failure);
        console.warn('Export image could not be embedded:', failure);
      }
      completed += 1;
      options.onProgress?.({ completed, total: uniqueTasks.length });
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(concurrency, Math.max(1, uniqueTasks.length)) },
    () => worker(),
  ));
  return { results, failures, total: uniqueTasks.length };
};

export const getInlineExportImageSources = (note?: NoteData) => {
  const storedPlaceholders = new Set(getStoredImagesFromNote(note).map(storagePlaceholderSrc));
  let htmlSources = extractImagesFromHtml(note?.contentHtml);
  if (note?.contentHtml && typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = note.contentHtml;
    htmlSources = Array.from(container.querySelectorAll<HTMLImageElement>('img'))
      .filter(image => !(image.dataset.mediaProvider === 'supabase' && image.dataset.mediaPath))
      .map(image => image.getAttribute('src') || '');
  }
  const sources = [...htmlSources, ...getLegacyNoteImages(note)];

  return Array.from(new Set(sources)).filter(src => (
    Boolean(src) && !storedPlaceholders.has(src) && !src.startsWith('storage://')
  ));
};

export const hasImageExportError = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasImageExportError);
  if (!value || typeof value !== 'object') return false;
  if ('exportError' in value && Boolean((value as { exportError?: unknown }).exportError)) return true;
  return Object.values(value).some(hasImageExportError);
};

export const buildReadableExportHtml = ({
  appName,
  account,
  profileName,
  exportedAt,
  locations,
  locale,
}: {
  appName: string;
  account: string;
  profileName: string;
  exportedAt: string;
  locale: string;
  locations: Array<{
    index: number;
    lat: number;
    lng: number;
    createdAt?: number | null;
    notes: Array<{
      title: string;
      text: string;
      timestamp: number;
      images: ExportedImageData[];
    }>;
  }>;
}) => {
  const formatDate = (timestamp?: number | string | null) => {
    const date = timestamp ? new Date(timestamp) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const imageHtml = (image: ExportedImageData, index: number) => {
    if (!image.dataUrl) {
      return `<div class="image-missing">Image ${index + 1} could not be embedded.</div>`;
    }
    return (
      '<figure class="image-frame">' +
        `<img src="${image.dataUrl}" alt="Exported image ${index + 1}" />` +
      '</figure>'
    );
  };

  const locationHtml = locations.map(location => (
    `<section class="location">` +
      `<div class="location-head">` +
        `<div>` +
          `<h2>Location ${location.index}</h2>` +
          `<p class="meta">Coordinates: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}</p>` +
          (location.createdAt ? `<p class="meta">Created: ${formatDate(location.createdAt)}</p>` : '') +
        `</div>` +
      `</div>` +
      location.notes.map(note => (
        `<article class="note">` +
          `<h3>${escapeHtml(note.title || 'Untitled note')}</h3>` +
          `<p class="meta">Time: ${formatDate(note.timestamp)}</p>` +
          (note.text ? `<p class="note-text">${escapeHtml(note.text)}</p>` : '<p class="empty">No text</p>') +
          (note.images.length > 0 ? `<div class="images">${note.images.map(imageHtml).join('')}</div>` : '') +
        `</article>`
      )).join('') +
    `</section>`
  )).join('');

  return (
    '<!doctype html>' +
    `<html lang="${locale.startsWith('zh') ? 'zh-CN' : locale.startsWith('ko') ? 'ko-KR' : 'en'}">` +
    '<head>' +
      '<meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      `<title>${escapeHtml(appName)} Export</title>` +
      '<style>' +
        'body{margin:0;background:#f4f4f4;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55;}' +
        '.page{max-width:860px;margin:0 auto;padding:42px 22px 64px;}' +
        'header{margin-bottom:28px;}' +
        'h1{margin:0 0 8px;font-size:34px;line-height:1.08;}' +
        'h2{margin:0 0 6px;font-size:24px;}' +
        'h3{margin:0 0 6px;font-size:20px;}' +
        '.meta{margin:2px 0;color:#666;font-size:13px;}' +
        '.summary{margin-top:14px;padding:14px 16px;border-radius:14px;background:#fff;}' +
        '.location{margin:22px 0;padding:20px;border-radius:18px;background:#fff;box-shadow:0 1px 8px rgba(0,0,0,.04);}' +
        '.location-head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #eee;padding-bottom:12px;margin-bottom:16px;}' +
        '.note{padding:14px 0;border-top:1px solid #f0f0f0;}' +
        '.note:first-of-type{border-top:0;padding-top:0;}' +
        '.note-text{white-space:pre-wrap;margin:12px 0;font-size:15px;}' +
        '.empty{color:#999;font-size:14px;}' +
        '.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:12px;}' +
        '.image-frame{margin:0;border-radius:14px;overflow:hidden;background:#eee;}' +
        '.image-frame img{display:block;width:100%;height:auto;}' +
        '.image-missing{border-radius:12px;background:#f1f1f1;color:#777;padding:12px;font-size:13px;}' +
        '@media print{body{background:#fff}.page{max-width:none;padding:0}.location{box-shadow:none;break-inside:avoid}}' +
      '</style>' +
    '</head>' +
    '<body>' +
      '<main class="page">' +
        '<header>' +
          `<h1>${escapeHtml(appName)}</h1>` +
          `<p class="meta">Account: ${escapeHtml(account || 'user')}</p>` +
          (profileName ? `<p class="meta">Name: ${escapeHtml(profileName)}</p>` : '') +
          `<p class="meta">Exported: ${formatDate(exportedAt)}</p>` +
          `<div class="summary">${locations.length} locations, ${locations.reduce((sum, location) => sum + location.notes.length, 0)} notes</div>` +
        '</header>' +
        (locationHtml || '<section class="location"><p class="empty">No notes yet.</p></section>') +
      '</main>' +
    '</body>' +
    '</html>'
  );
};
