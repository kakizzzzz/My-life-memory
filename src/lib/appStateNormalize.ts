import { sanitizeRichHtml } from './htmlSanitizer';
import type { StoredImageMetadata } from './mediaStorage';

type LooseRecord = Record<string, unknown>;

const MAX_HTML_LENGTH = 240_000;
const MAX_TEXT_LENGTH = 40_000;
const MAX_LEGACY_IMAGE_URL_LENGTH = 140_000;
const MAX_LEGACY_IMAGE_URLS = 80;
const MAX_NOTES_PER_STAR = 300;
const MAX_STARS = 5000;
const MAX_TRACKS = 1000;
const MAX_TRACK_SEGMENTS = 200;
const MAX_TRACK_POINTS = 20_000;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const getString = (value: unknown, fallback = '') => (
  typeof value === 'string' ? value : fallback
);

const getFiniteNumber = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const getOptionalNumber = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const clampString = (value: unknown, maxLength: number) => (
  getString(value).slice(0, maxLength)
);

const isRecord = (value: unknown): value is LooseRecord => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isCoordinate = (lat: unknown, lng: unknown) => {
  const latNumber = Number(lat);
  const lngNumber = Number(lng);
  return (
    Number.isFinite(latNumber) &&
    Number.isFinite(lngNumber) &&
    latNumber >= -90 &&
    latNumber <= 90 &&
    lngNumber >= -180 &&
    lngNumber <= 180
  );
};

const normalizeColor = (value: unknown) => {
  const color = getString(value).trim();
  return HEX_COLOR_PATTERN.test(color) ? color : undefined;
};

const normalizeHtml = (value: unknown) => {
  const html = getString(value);
  if (!html || html.length > MAX_HTML_LENGTH) return '';
  return sanitizeRichHtml(html);
};

const normalizeLegacyImageUrl = (value: unknown) => {
  const url = getString(value).trim();
  if (!url || url.length > MAX_LEGACY_IMAGE_URL_LENGTH) return '';
  const lowered = url.toLowerCase();
  if (lowered.startsWith('data:')) {
    return /^data:image\/(?:jpeg|jpg|png|webp|gif);/i.test(lowered) ? url : '';
  }
  if (lowered.startsWith('storage://')) return url;
  if ((lowered.startsWith('http://') || lowered.startsWith('https://')) && url.length <= 2000) return url;
  return '';
};

const normalizeLegacyImageUrls = (value: unknown) => (
  Array.isArray(value)
    ? value
        .slice(0, MAX_LEGACY_IMAGE_URLS)
        .map(normalizeLegacyImageUrl)
        .filter(Boolean)
    : []
);

const normalizeStoredImage = (value: unknown): StoredImageMetadata | null => {
  if (!isRecord(value)) return null;
  const provider = value.provider === 'supabase' ? 'supabase' : null;
  const bucket = getString(value.bucket);
  const path = getString(value.path || value.key);
  if (!provider || !bucket || !path || path.length > 512) return null;

  return {
    provider,
    bucket,
    key: path,
    path,
    mimeType: clampString(value.mimeType, 120) || 'image/jpeg',
    size: Math.max(0, getFiniteNumber(value.size, 0)),
    createdAt: Math.max(0, getFiniteNumber(value.createdAt, Date.now())),
  };
};

const normalizeImages = (value: unknown) => (
  Array.isArray(value)
    ? value.map(normalizeStoredImage).filter((image): image is StoredImageMetadata => Boolean(image))
    : []
);

const normalizeNote = (value: unknown, fallbackIndex: number) => {
  if (!isRecord(value)) return null;

  const createdAt = getOptionalNumber(value.createdAt);
  const updatedAt = getOptionalNumber(value.updatedAt);
  return {
    id: clampString(value.id, 96) || `note-${fallbackIndex}-${createdAt || Date.now()}`,
    title: clampString(value.title, MAX_TEXT_LENGTH),
    titleHtml: normalizeHtml(value.titleHtml),
    content: clampString(value.content, MAX_TEXT_LENGTH),
    contentHtml: normalizeHtml(value.contentHtml),
    imageUrl: normalizeLegacyImageUrl(value.imageUrl) || undefined,
    imageUrls: normalizeLegacyImageUrls(value.imageUrls),
    images: normalizeImages(value.images),
    fontSize: getOptionalNumber(value.fontSize),
    titleFontSize: getOptionalNumber(value.titleFontSize),
    createdAt,
    updatedAt,
    color: normalizeColor(value.color),
  };
};

const normalizeStar = (value: unknown, fallbackIndex: number) => {
  if (!isRecord(value) || !isCoordinate(value.lat, value.lng)) return null;

  return {
    id: clampString(value.id, 96) || `star-${fallbackIndex}`,
    lat: getFiniteNumber(value.lat),
    lng: getFiniteNumber(value.lng),
    createdAt: getOptionalNumber(value.createdAt),
    tagOrder: getOptionalNumber(value.tagOrder),
    tagGroupId: getOptionalNumber(value.tagGroupId),
    color: normalizeColor(value.color),
    notes: Array.isArray(value.notes)
      ? value.notes.slice(0, MAX_NOTES_PER_STAR).map(normalizeNote).filter(Boolean)
      : [],
  };
};

const normalizePathPoint = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2 || !isCoordinate(value[0], value[1])) return null;
  return [getFiniteNumber(value[0]), getFiniteNumber(value[1])];
};

const normalizeTrackPaths = (value: unknown): [number, number][][] => {
  if (!Array.isArray(value)) return [];
  let remainingPoints = MAX_TRACK_POINTS;
  const paths: [number, number][][] = [];

  for (const segment of value.slice(0, MAX_TRACK_SEGMENTS)) {
    if (!Array.isArray(segment) || remainingPoints <= 0) continue;
    const points = segment
      .slice(0, remainingPoints)
      .map(normalizePathPoint)
      .filter((point): point is [number, number] => Boolean(point));
    remainingPoints -= points.length;
    if (points.length > 1) paths.push(points);
  }

  return paths;
};

const normalizeTrack = (value: unknown, fallbackIndex: number) => {
  if (!isRecord(value)) return null;
  const paths = normalizeTrackPaths(value.paths);
  if (paths.length === 0) return null;

  return {
    id: clampString(value.id, 96) || `track-${fallbackIndex}`,
    paths,
    color: normalizeColor(value.color),
    time: getOptionalNumber(value.time),
    distance: Math.max(0, getFiniteNumber(value.distance, 0)),
  };
};

const normalizeProfile = (value: unknown) => {
  if (!isRecord(value)) return {};
  return {
    name: clampString(value.name, 120),
    account: clampString(value.account, 120).trim().toLowerCase(),
    avatarUrl: clampString(value.avatarUrl, 2000),
    avatarImage: normalizeStoredImage(value.avatarImage) || undefined,
  };
};

const normalizeProfileConflicts = (value: unknown) => (
  Array.isArray(value)
    ? value.slice(0, 20).map(entry => {
        if (!isRecord(entry)) return null;
        const name = clampString(entry.name, 120);
        const avatarUrl = clampString(entry.avatarUrl, 2000);
        const avatarImage = normalizeStoredImage(entry.avatarImage) || undefined;
        if (!name && !avatarUrl && !avatarImage) return null;
        return {
          name: name || undefined,
          avatarUrl: avatarUrl || undefined,
          avatarImage,
          capturedAt: Math.max(0, getFiniteNumber(entry.capturedAt, Date.now())),
          source: 'remote' as const,
        };
      }).filter(Boolean)
    : []
);

export const normalizePersistedAppState = <T extends LooseRecord | null | undefined>(state: T): T => {
  if (!isRecord(state)) return null as T;

  const next: LooseRecord = {
    ...state,
    profile: normalizeProfile(state.profile),
    profileConflicts: normalizeProfileConflicts(state.profileConflicts),
    stars: Array.isArray(state.stars)
      ? state.stars.slice(0, MAX_STARS).map(normalizeStar).filter(Boolean)
      : [],
    savedTracks: Array.isArray(state.savedTracks)
      ? state.savedTracks.slice(0, MAX_TRACKS).map(normalizeTrack).filter(Boolean)
      : [],
  };

  return next as T;
};
