import {
  memoryDistanceKm,
  type MemoryPlaceResolutionSummary,
  type ResolvedMemoryPlace,
} from './memory-research.ts';

type Coordinate = { lat: number; lng: number };

type NominatimRow = {
  display_name?: unknown;
  name?: unknown;
  lat?: unknown;
  lon?: unknown;
  boundingbox?: unknown;
  type?: unknown;
  addresstype?: unknown;
  importance?: unknown;
  address?: unknown;
};

type PlaceCandidate = ResolvedMemoryPlace & {
  importance: number;
  memoryHitCount: number;
  latestDistanceKm: number | null;
};

export type ResolveMemoryPlaceInput = {
  place: string;
  countryCode?: string;
  memoryCoordinates?: Coordinate[];
  latestCoordinate?: Coordinate | null;
  endpoint?: string;
  userAgent?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type ResolveMemoryPlaceResult = {
  resolvedPlace: ResolvedMemoryPlace | null;
  summary: MemoryPlaceResolutionSummary;
  candidates: Array<{
    name: string;
    displayName: string;
    type: string;
    countryCode: string;
    center: Coordinate;
    memoryHitCount: number;
  }>;
};

const NOMINATIM_ATTRIBUTION = 'Geocoding data © OpenStreetMap contributors, ODbL 1.0.';
const DEFAULT_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_USER_AGENT = 'MyLifeMemory/1.0 (https://github.com/kakizzzzz/My-life-memory)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const cache = new Map<string, { expiresAt: number; rows: NominatimRow[] }>();
let nextRequestAt = 0;

const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const coordinate = (lat: unknown, lng: unknown): Coordinate | null => {
  const latitude = finite(lat);
  const longitude = finite(lng);
  if (latitude === null || longitude === null
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lng: longitude };
};

const radiusForType = (type: string) => {
  if (type === 'city') return 25;
  if (type === 'town' || type === 'municipality') return 15;
  if (type === 'village' || type === 'borough' || type === 'suburb') return 8;
  if (type === 'hamlet' || type === 'neighbourhood') return 5;
  return 10;
};

const paddedBox = (row: NominatimRow, center: Coordinate, type: string) => {
  const raw = Array.isArray(row.boundingbox) ? row.boundingbox.map(finite) : [];
  const south = raw[0] ?? null;
  const north = raw[1] ?? null;
  const west = raw[2] ?? null;
  const east = raw[3] ?? null;
  const radiusKm = radiusForType(type);
  const minimumLatHalfSpan = radiusKm / 111;
  const longitudeScale = Math.max(0.2, Math.cos(center.lat * Math.PI / 180));
  const minimumLngHalfSpan = radiusKm / (111 * longitudeScale);
  const latHalfSpan = south !== null && north !== null
    ? Math.max(minimumLatHalfSpan, Math.abs(north - south) * 0.6)
    : minimumLatHalfSpan;
  const lngHalfSpan = west !== null && east !== null
    ? Math.max(minimumLngHalfSpan, Math.abs(east - west) * 0.6)
    : minimumLngHalfSpan;
  return [
    Math.max(-90, center.lat - latHalfSpan),
    Math.max(-180, center.lng - lngHalfSpan),
    Math.min(90, center.lat + latHalfSpan),
    Math.min(180, center.lng + lngHalfSpan),
  ] as const;
};

const pointInBoxes = (point: Coordinate, boxes: ResolvedMemoryPlace['boxes']) => (
  boxes.some(([minLat, minLng, maxLat, maxLng]) => (
    point.lat >= minLat && point.lat <= maxLat && point.lng >= minLng && point.lng <= maxLng
  ))
);

const countryCodeFor = (row: NominatimRow) => {
  if (!row.address || typeof row.address !== 'object') return '';
  const value = (row.address as Record<string, unknown>).country_code;
  return typeof value === 'string' ? value.toUpperCase() : '';
};

const candidateFor = (
  row: NominatimRow,
  memoryCoordinates: Coordinate[],
  latestCoordinate: Coordinate | null,
): PlaceCandidate | null => {
  const center = coordinate(row.lat, row.lon);
  const displayName = typeof row.display_name === 'string' ? row.display_name.trim() : '';
  if (!center || !displayName) return null;
  const type = String(row.addresstype || row.type || 'place').trim().toLowerCase();
  const boxes = [paddedBox(row, center, type)];
  const memoryHitCount = memoryCoordinates.filter(point => pointInBoxes(point, boxes)).length;
  return {
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : displayName.split(',')[0].trim(),
    displayName,
    type,
    countryCode: countryCodeFor(row),
    center,
    boxes,
    provider: 'Nominatim',
    attribution: NOMINATIM_ATTRIBUTION,
    importance: Math.max(0, finite(row.importance) || 0),
    memoryHitCount,
    latestDistanceKm: latestCoordinate ? memoryDistanceKm(latestCoordinate, center) : null,
  };
};

const waitForPublicServiceSlot = async () => {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + 1_000;
  if (scheduledAt > now) await new Promise(resolve => setTimeout(resolve, scheduledAt - now));
};

const fetchRows = async ({
  place,
  countryCode,
  endpoint,
  userAgent,
  timeoutMs,
  fetchImpl,
}: Required<Pick<ResolveMemoryPlaceInput, 'place' | 'endpoint' | 'userAgent' | 'timeoutMs' | 'fetchImpl'>> & {
  countryCode: string;
}) => {
  const cacheKey = `${endpoint}|${countryCode}|${place.normalize('NFKC').toLocaleLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  await waitForPublicServiceSlot();
  const url = new URL(endpoint);
  url.searchParams.set('q', place);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('layer', 'address');
  url.searchParams.set('limit', '5');
  url.searchParams.set('accept-language', 'zh,en,ja,ko');
  if (countryCode) url.searchParams.set('countrycodes', countryCode.toLowerCase());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        'User-Agent': userAgent,
        Referer: 'https://kakizzzzz.github.io/My-life-memory/',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Place resolver returned HTTP ${response.status}.`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload as NominatimRow[] : [];
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, rows });
    return rows;
  } finally {
    clearTimeout(timeout);
  }
};

export const resolveMemoryPlace = async (input: ResolveMemoryPlaceInput): Promise<ResolveMemoryPlaceResult> => {
  const place = String(input.place || '').trim().replace(/\s+/g, ' ');
  if (!place) return {
    resolvedPlace: null,
    summary: { status: 'not-requested' },
    candidates: [],
  };
  if (place.length > 160) return {
    resolvedPlace: null,
    summary: { status: 'unavailable', query: place.slice(0, 160), message: 'Place name is too long.' },
    candidates: [],
  };
  const endpoint = String(input.endpoint || DEFAULT_ENDPOINT).trim();
  const userAgent = String(input.userAgent || DEFAULT_USER_AGENT).trim();
  const timeoutMs = Math.min(10_000, Math.max(1_000, Number(input.timeoutMs) || 5_000));
  try {
    const rows = await fetchRows({
      place,
      countryCode: String(input.countryCode || '').trim().toUpperCase(),
      endpoint,
      userAgent,
      timeoutMs,
      fetchImpl: input.fetchImpl || fetch,
    });
    const memoryCoordinates = (input.memoryCoordinates || []).filter(point => Boolean(coordinate(point.lat, point.lng)));
    const latestCoordinate = input.latestCoordinate
      ? coordinate(input.latestCoordinate.lat, input.latestCoordinate.lng)
      : null;
    const candidates = rows.map(row => candidateFor(row, memoryCoordinates, latestCoordinate))
      .filter((candidate): candidate is PlaceCandidate => Boolean(candidate))
      .sort((left, right) => right.memoryHitCount - left.memoryHitCount
        || right.importance - left.importance
        || (left.latestDistanceKm ?? Number.POSITIVE_INFINITY) - (right.latestDistanceKm ?? Number.POSITIVE_INFINITY));
    const selected = candidates[0] || null;
    if (!selected) return {
      resolvedPlace: null,
      summary: {
        status: 'not-found',
        query: place,
        candidateCount: 0,
        message: 'No matching city, town, village, or administrative place was resolved.',
      },
      candidates: [],
    };
    const resolvedPlace: ResolvedMemoryPlace = {
      name: selected.name,
      displayName: selected.displayName,
      type: selected.type,
      countryCode: selected.countryCode,
      center: selected.center,
      boxes: selected.boxes,
      provider: selected.provider,
      attribution: selected.attribution,
    };
    const publicCandidates = candidates.slice(0, 3).map(candidate => ({
      name: candidate.name,
      displayName: candidate.displayName,
      type: candidate.type,
      countryCode: candidate.countryCode,
      center: candidate.center,
      memoryHitCount: candidate.memoryHitCount,
    }));
    return {
      resolvedPlace,
      summary: {
        status: 'resolved',
        query: place,
        candidateCount: candidates.length,
        selectionReason: selected.memoryHitCount > 0
          ? 'candidate-with-most-saved-memory-locations'
          : 'provider-importance-with-latest-recorded-memory-as-tie-breaker',
      },
      candidates: publicCandidates,
    };
  } catch (error) {
    return {
      resolvedPlace: null,
      summary: {
        status: 'unavailable',
        query: place,
        message: error instanceof Error && error.name === 'AbortError'
          ? 'Place resolution timed out.'
          : error instanceof Error ? error.message : 'Place resolution failed.',
      },
      candidates: [],
    };
  }
};
