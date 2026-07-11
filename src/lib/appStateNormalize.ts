import { sanitizeRichHtml } from './htmlSanitizer';
import type { StoredImageMetadata } from './mediaStorage';

type LooseRecord = Record<string, unknown>;

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const getString = (value: unknown, fallback = '') => (
  typeof value === 'string' ? value : fallback
);

const getFiniteNumber = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const getOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const preserveString = (value: unknown) => getString(value);

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
  if (!html) return '';
  // Existing data is never blanked or truncated while loading. Per-record
  // write limits are enforced after the mutation is durable and before upload.
  return sanitizeRichHtml(html);
};

const normalizeLegacyImageUrl = (value: unknown) => {
  const url = getString(value).trim();
  if (!url) return '';
  const lowered = url.toLowerCase();
  if (lowered.startsWith('data:')) {
    return /^data:image\/(?:jpeg|jpg|png|webp|gif);/i.test(lowered) ? url : '';
  }
  if (lowered.startsWith('storage://')) return url;
  if (lowered.startsWith('http://') || lowered.startsWith('https://')) return url;
  return '';
};

const normalizeLegacyImageUrls = (value: unknown) => (
  Array.isArray(value)
    ? value
        .map(normalizeLegacyImageUrl)
        .filter(Boolean)
    : []
);

const normalizeStoredImage = (value: unknown): StoredImageMetadata | null => {
  if (!isRecord(value)) return null;
  const provider = value.provider === 'supabase' ? 'supabase' : null;
  const bucket = getString(value.bucket);
  const path = getString(value.path || value.key);
  if (!provider || !bucket || !path) return null;

  return {
    provider,
    bucket,
    key: path,
    path,
    mimeType: preserveString(value.mimeType) || 'image/jpeg',
    size: getFiniteNumber(value.size, 0),
    createdAt: getFiniteNumber(value.createdAt, 0),
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
    id: preserveString(value.id) || `note-${fallbackIndex}-${createdAt || Date.now()}`,
    title: preserveString(value.title),
    titleHtml: normalizeHtml(value.titleHtml),
    content: preserveString(value.content),
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
    id: preserveString(value.id) || `star-${fallbackIndex}`,
    lat: getFiniteNumber(value.lat),
    lng: getFiniteNumber(value.lng),
    createdAt: getOptionalNumber(value.createdAt),
    tagOrder: getOptionalNumber(value.tagOrder),
    tagGroupId: getOptionalNumber(value.tagGroupId),
    color: normalizeColor(value.color),
    notes: Array.isArray(value.notes)
      ? value.notes.map(normalizeNote).filter(Boolean)
      : [],
  };
};

const normalizePathPoint = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2 || !isCoordinate(value[0], value[1])) return null;
  return [getFiniteNumber(value[0]), getFiniteNumber(value[1])];
};

const normalizeTrackPaths = (value: unknown): [number, number][][] => {
  if (!Array.isArray(value)) return [];
  const paths: [number, number][][] = [];

  for (const segment of value) {
    if (!Array.isArray(segment)) continue;
    const points = segment
      .map(normalizePathPoint)
      .filter((point): point is [number, number] => Boolean(point));
    if (points.length > 1) paths.push(points);
  }

  return paths;
};

const normalizeTrack = (value: unknown, fallbackIndex: number) => {
  if (!isRecord(value)) return null;
  const paths = normalizeTrackPaths(value.paths);
  if (paths.length === 0) return null;

  return {
    id: preserveString(value.id) || `track-${fallbackIndex}`,
    paths,
    color: normalizeColor(value.color),
    time: getOptionalNumber(value.time),
    distance: Math.max(0, getFiniteNumber(value.distance, 0)),
    createdAt: getOptionalNumber(value.createdAt),
    updatedAt: getOptionalNumber(value.updatedAt),
  };
};

const normalizeProfile = (value: unknown) => {
  if (!isRecord(value)) return {};
  return {
    name: preserveString(value.name),
    account: preserveString(value.account).trim().toLowerCase(),
    avatarUrl: preserveString(value.avatarUrl),
    avatarImage: normalizeStoredImage(value.avatarImage) || undefined,
  };
};

const normalizeProfileConflicts = (value: unknown) => (
  Array.isArray(value)
    ? value.map(entry => {
        if (!isRecord(entry)) return null;
        const name = preserveString(entry.name);
        const avatarUrl = preserveString(entry.avatarUrl);
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
      ? state.stars.map(normalizeStar).filter(Boolean)
      : [],
    savedTracks: Array.isArray(state.savedTracks)
      ? state.savedTracks.map(normalizeTrack).filter(Boolean)
      : [],
  };

  return next as T;
};
