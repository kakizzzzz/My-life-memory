import type { NoteData } from '../types/app';
import {
  createSignedImageUrl,
  storagePlaceholderSrc,
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
};

const blobToDataUrl = (blob: Blob) => (
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  })
);

const getDataUrlMimeType = (dataUrl: string) => (
  dataUrl.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream'
);

const getDataUrlApproxSize = (dataUrl: string) => {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.max(0, Math.floor((base64.length * 3) / 4));
};

const fetchImageAsDataUrl = async (src: string) => {
  if (src.startsWith('data:')) {
    return {
      dataUrl: src,
      mimeType: getDataUrlMimeType(src),
      size: getDataUrlApproxSize(src),
    };
  }

  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return {
    dataUrl: await blobToDataUrl(blob),
    mimeType: blob.type || 'image/jpeg',
    size: blob.size,
  };
};

export const exportImageSource = async (src: string, source: string): Promise<ExportedImageData | null> => {
  if (!src || src.startsWith('storage://')) return null;

  try {
    const imageData = await fetchImageAsDataUrl(src);
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
    };
  }
};

export const exportStoredImage = async (metadata: StoredImageMetadata, source: string): Promise<ExportedImageData> => {
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
    const signedUrl = await createSignedImageUrl(metadata);
    const imageData = signedUrl ? await fetchImageAsDataUrl(signedUrl) : null;
    return {
      ...baseImage,
      src: storagePlaceholderSrc(metadata),
      ...(imageData || {}),
    };
  } catch (error) {
    return {
      ...baseImage,
      src: storagePlaceholderSrc(metadata),
      exportError: error instanceof Error ? error.message : String(error),
    };
  }
};

export const getInlineExportImageSources = (note?: NoteData) => {
  const storedPlaceholders = new Set(getStoredImagesFromNote(note).map(storagePlaceholderSrc));
  const sources = [
    ...extractImagesFromHtml(note?.contentHtml),
    ...getLegacyNoteImages(note),
  ];

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
