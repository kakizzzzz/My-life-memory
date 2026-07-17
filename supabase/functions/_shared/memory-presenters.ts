import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
  TrackRow,
} from './memory-record-types.ts';
export {
  dateKeyFor,
  isInDateRange,
} from './memory-date.ts';
import {
  dateKeyFor,
} from './memory-date.ts';

export const getString = (value: unknown, fallback = '') => (
  typeof value === 'string' ? value : fallback
);

export const getNumber = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export const getBoolean = (value: unknown) => value === true || value === 'true';

export const getArray = (value: unknown) => (Array.isArray(value) ? value : []);

export const isFiniteCoordinate = (lat: unknown, lng: unknown) => {
  const latNumber = Number(lat);
  const lngNumber = Number(lng);
  return Number.isFinite(latNumber) && Number.isFinite(lngNumber)
    && latNumber >= -90 && latNumber <= 90
    && lngNumber >= -180 && lngNumber <= 180;
};

const stripHtml = (html = '') => html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const cleanImageMetadata = (value: unknown) => {
  const image = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    provider: getString(image.provider),
    bucket: getString(image.bucket),
    key: getString(image.key),
    path: getString(image.path),
    mimeType: getString(image.mimeType),
    size: getNumber(image.size),
    createdAt: getNumber(image.createdAt) || null,
  };
};

export const noteImages = (note: NoteRow) => getArray(note.images)
  .map(cleanImageMetadata)
  .filter(image => image.path || image.key);

export const noteText = (note: NoteRow) => note.content.trim() || stripHtml(note.content_html);

export const noteTitle = (note: NoteRow) => {
  const explicit = note.title.trim() || stripHtml(note.title_html);
  const text = explicit || noteText(note);
  return text.length > 40 ? `${text.slice(0, 40)}...` : text || 'Untitled note';
};

export const notesByStarId = (notes: NoteRow[]) => {
  const output = new Map<string, NoteRow[]>();
  notes.forEach(note => output.set(note.star_id, [...(output.get(note.star_id) || []), note]));
  return output;
};

export const starSummary = (star: StarRow, index: number, notes: NoteRow[]) => ({
  id: star.id,
  index,
  lat: star.lat,
  lng: star.lng,
  color: star.color || '',
  createdAt: star.created_at_ms,
  noteCount: notes.length,
  meaningfulNoteCount: notes.filter(note => noteText(note).length > 0 || noteImages(note).length > 0).length,
  tagOrder: star.tag_order,
  tagGroupId: star.tag_group_id,
});

export const noteSummary = (
  note: NoteRow,
  star: StarRow,
  starIndex: number,
  noteIndex: number,
  query = '',
) => {
  const text = noteText(note);
  const lowerText = `${noteTitle(note)} ${text}`.toLowerCase();
  const lowerQuery = query.trim().toLowerCase();
  let matchCount = 0;
  if (lowerQuery) {
    let start = 0;
    while (start < lowerText.length) {
      const index = lowerText.indexOf(lowerQuery, start);
      if (index === -1) break;
      matchCount += 1;
      start = index + Math.max(1, lowerQuery.length);
    }
  }
  return {
    id: note.id,
    starId: note.star_id,
    starIndex,
    noteIndex,
    title: noteTitle(note),
    text,
    snippet: text.length > 180 ? `${text.slice(0, 180)}...` : text,
    createdAt: note.created_at_ms ?? star.created_at_ms,
    updatedAt: note.updated_at_ms,
    color: note.color || '',
    images: noteImages(note),
    matchCount,
    coordinates: { lat: star.lat, lng: star.lng },
  };
};

export const routeSummary = (track: TrackRow, includePaths = false) => ({
  id: track.id,
  color: track.color || '',
  durationSeconds: Math.max(0, Number(track.duration_seconds) || 0),
  time: Math.max(0, Number(track.duration_seconds) || 0),
  distance: Math.max(0, Number(track.distance_km) || 0),
  createdAt: track.created_at_ms,
  updatedAt: track.updated_at_ms,
  segmentCount: getArray(track.paths).length,
  pointCount: getArray(track.paths).reduce((sum, segment) => sum + getArray(segment).length, 0),
  paths: includePaths ? track.paths : undefined,
});

const escapeHtml = (value: unknown) => getString(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const buildMemoryReportHtml = (memory: NormalizedMemoryRows, timeZone: string) => {
  const grouped = notesByStarId(memory.notes);
  const locations = memory.stars.map((star, starIndex) => {
    const notes = (grouped.get(star.id) || []).map((note, noteIndex) => {
      const summary = noteSummary(note, star, starIndex, noteIndex);
      return '<article class="note">'
        + `<h3>${escapeHtml(summary.title)}</h3>`
        + `<p class="meta">Time: ${escapeHtml(dateKeyFor(summary.createdAt, timeZone))}</p>`
        + (summary.text ? `<p class="text">${escapeHtml(summary.text)}</p>` : '<p class="empty">No text</p>')
        + (summary.images.length ? `<p class="meta">${summary.images.length} image(s)</p>` : '')
        + '</article>';
    }).join('');
    return '<section class="location">'
      + `<h2>Location ${starIndex + 1}</h2>`
      + `<p class="meta">Coordinates: ${star.lat.toFixed(6)}, ${star.lng.toFixed(6)}</p>`
      + (notes || '<p class="empty">No notes</p>')
      + '</section>';
  }).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>My Life Memory Export</title>'
    + '<style>body{margin:0;background:#f4f4f4;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.page{max-width:880px;margin:0 auto;padding:40px 22px 64px}.location{background:#fff;border-radius:18px;padding:18px;margin:18px 0}.note{border-top:1px solid #eee;padding:12px 0}.note:first-of-type{border-top:0}.meta{color:#666;font-size:13px}.text{white-space:pre-wrap}.empty{color:#999}</style>'
    + '</head><body><main class="page"><header><h1>My Life Memory</h1>'
    + `<p class="meta">Account: ${escapeHtml(memory.account)}</p>`
    + (memory.profile?.name ? `<p class="meta">Name: ${escapeHtml(memory.profile.name)}</p>` : '')
    + `<p class="meta">${memory.stars.length} locations, ${memory.notes.length} notes</p>`
    + '</header>' + (locations || '<section class="location"><p class="empty">No memories yet.</p></section>')
    + '</main></body></html>';
};
