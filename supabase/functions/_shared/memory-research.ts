import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
  TrackRow,
} from './memory-record-types.ts';
import {
  MEMORY_COUNTRY_REGIONS,
  type MemoryCountryRegion,
} from './memory-country-regions.ts';
import { isInDateRange } from './memory-date.ts';
import { noteText, noteTitle } from './memory-presenters.ts';
import {
  buildBoundedArchiveReview,
  findTargetEvidencePassages,
  resolvePersonalMemoryContext,
  type MemoryEvidencePassage,
  type PersonalContextResolution,
} from './memory-personal-context.ts';
import {
  buildMemoryQueryPlan,
  inferMemoryQueryDateRange,
  type MemoryQueryDateRange,
} from './memory-query-plan.ts';
import { buildMemoryAnswerBoundary } from './memory-answer-boundary.ts';
import type { MemorySemanticReviewInput } from './memory-semantic-review.ts';
import { buildMemoryTemporalContext } from './time-zone.ts';
import { MCP_MEMORY_INSTRUCTIONS } from './mcp-memory-contract.mjs';

export { inferMemoryQueryDateRange } from './memory-query-plan.ts';
export type { MemoryQueryDateRange } from './memory-query-plan.ts';
export { MCP_MEMORY_INSTRUCTIONS } from './mcp-memory-contract.mjs';

const DAY_MS = 86_400_000;
const CLUSTER_GAP_MS = 72 * 60 * 60 * 1000;
const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 1_000;
const MAX_RETURNED_NOTES = 100;
const MAX_RETURNED_LOCATIONS = 100;
const MAX_RETURNED_ROUTES = 20;

export type MemoryResearchInput = {
  query?: string;
  place?: string;
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  centerLat?: number;
  centerLng?: number;
  radiusKm?: number;
  limit?: number;
  placeSource?: 'explicit-argument' | 'query-span';
  resolvedPlace?: ResolvedMemoryPlace | null;
  placeResolution?: MemoryPlaceResolutionSummary | null;
  confirmedReference?: ConfirmedMemoryReference | null;
  // Accepted for backward compatibility only. Host-model candidate verdicts
  // no longer have authority to promote unverified text into evidence.
  semanticReview?: MemorySemanticReviewInput | null;
};

export type ConfirmedMemoryReference = {
  noteId: string;
  starId: string;
  relation: 'home' | 'work' | 'study' | 'observation' | 'activity';
  label: string;
};

export type ResolvedMemoryPlace = {
  name: string;
  displayName: string;
  type: string;
  countryCode: string;
  center: Coordinate;
  boxes: readonly (readonly [number, number, number, number])[];
  provider: string;
  attribution: string;
};

export type MemoryPlaceResolutionSummary = {
  status: 'not-requested' | 'resolved' | 'ambiguous' | 'not-found' | 'unavailable';
  query?: string;
  selectionReason?: string;
  candidateCount?: number;
  message?: string;
};

type Coordinate = { lat: number; lng: number };

type CountryScope = {
  mode: 'country';
  code: string;
  name: string;
  matchedAlias: string;
  region: MemoryCountryRegion;
};

type RadiusScope = {
  mode: 'radius';
  center: Coordinate;
  radiusKm: number;
  matchedAlias: string;
};

type PlaceScope = {
  mode: 'place';
  place: ResolvedMemoryPlace;
  matchedAlias: string;
};

type PersonalScope = {
  mode: 'personal';
  anchorStarIds: string[];
  centers: Coordinate[];
  radiusKm: number;
  proximityRequested: boolean;
  resolution: PersonalContextResolution;
};

type SpatialScope = CountryScope | RadiusScope | PlaceScope | PersonalScope;

type NoteEntry = {
  note: NoteRow;
  star: StarRow;
  timestamp: number;
  textScore: number;
  targetEvidence: MemoryEvidencePassage[];
};

type ResearchEvidencePassage = MemoryEvidencePassage & {
  role: 'anchor' | 'target' | 'corroboration';
};

const normalizeCompact = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

const confidenceBandFor = (confidence: number) => (
  confidence >= 0.8 ? 'high' : confidence >= 0.65 ? 'medium' : confidence > 0 ? 'low' : 'none'
);

const noteHasImages = (note: NoteRow) => Boolean(
  note.image_url
  || note.image_urls?.length
  || note.images?.length
  || /data-media-(?:path|key)=/i.test(`${note.title_html} ${note.content_html}`)
);

const finiteCoordinate = (lat: unknown, lng: unknown): Coordinate | null => {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { lat: latitude, lng: longitude };
};

const radians = (degrees: number) => degrees * Math.PI / 180;

export const memoryDistanceKm = (left: Coordinate, right: Coordinate) => {
  const earthRadiusKm = 6_371;
  const deltaLat = radians(right.lat - left.lat);
  const deltaLng = radians(right.lng - left.lng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
};

const aliasIndex = MEMORY_COUNTRY_REGIONS.flatMap(region => (
  region.aliases.map(alias => ({
    alias,
    normalized: normalizeCompact(alias),
    canonicalRank: normalizeCompact(region.name) === normalizeCompact(alias)
      ? 2
      : normalizeCompact(region.name).includes(normalizeCompact(alias))
        ? 1
        : 0,
    region,
  }))
)).filter(entry => entry.normalized.length >= 2)
  .sort((left, right) => right.normalized.length - left.normalized.length
    || right.canonicalRank - left.canonicalRank
    || left.region.code.localeCompare(right.region.code));

const latinCountryAlias = (value: string) => /^[\p{Script=Latin}\p{N}\s.'’()&-]+$/u.test(value);

const boundedLatinAliasMatches = (source: string, alias: string) => {
  const escaped = alias
    .normalize('NFKC')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(
    source.normalize('NFKC'),
  );
};

export const resolveMemoryCountryRegion = (value: string) => {
  const source = String(value || '').normalize('NFKC');
  const normalizedSource = normalizeCompact(source);
  if (!normalizedSource) return null;
  for (const entry of aliasIndex) {
    const matches = latinCountryAlias(entry.alias)
      ? boundedLatinAliasMatches(source, entry.alias)
      : normalizedSource.includes(entry.normalized);
    if (matches) return {
      region: entry.region,
      matchedAlias: entry.alias,
    };
  }
  return null;
};

export const resolveExactMemoryCountryRegion = (value: string) => {
  const normalized = normalizeCompact(value);
  if (!normalized) return null;
  const entry = aliasIndex.find(candidate => candidate.normalized === normalized);
  return entry ? { region: entry.region, matchedAlias: entry.alias } : null;
};

const parseCoordinatePair = (value: string) => {
  const match = value.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)/);
  return match ? finiteCoordinate(match[1], match[2]) : null;
};

const parseRadiusKm = (value: string) => {
  const kilometres = value.match(/(\d+(?:\.\d+)?)\s*(?:km|公里|千米|킬로미터)/i);
  if (kilometres) return Number(kilometres[1]);
  const metres = value.match(/(\d+(?:\.\d+)?)\s*(?:m|米|미터)(?![a-z])/i);
  return metres ? Number(metres[1]) / 1_000 : null;
};

const clampRadiusKm = (value: unknown) => {
  const radius = Number(value);
  if (!Number.isFinite(radius)) return DEFAULT_RADIUS_KM;
  return Math.min(MAX_RADIUS_KM, Math.max(0.1, radius));
};

const resolveSpatialScope = (input: MemoryResearchInput): SpatialScope | null => {
  const explicitCenter = finiteCoordinate(input.centerLat, input.centerLng);
  const queryCenter = parseCoordinatePair(String(input.query || ''));
  const center = explicitCenter || queryCenter;
  if (center) {
    const radius = Number.isFinite(Number(input.radiusKm))
      ? Number(input.radiusKm)
      : parseRadiusKm(String(input.query || ''));
    return {
      mode: 'radius',
      center,
      radiusKm: clampRadiusKm(radius),
      matchedAlias: explicitCenter ? 'explicit coordinates' : 'query coordinates',
    };
  }
  if (input.resolvedPlace) {
    return {
      mode: 'place',
      place: input.resolvedPlace,
      matchedAlias: String(input.place || input.resolvedPlace.name),
    };
  }
  const country = resolveMemoryCountryRegion(String(input.region || ''))
    || resolveMemoryCountryRegion(String(input.place || ''))
    || resolveMemoryCountryRegion(String(input.query || ''));
  return country ? {
    mode: 'country',
    code: country.region.code,
    name: country.region.name,
    matchedAlias: country.matchedAlias,
    region: country.region,
  } : null;
};

const coordinateInScope = (coordinate: Coordinate, scope: SpatialScope | null) => {
  if (!scope) return true;
  if (scope.mode === 'radius') return memoryDistanceKm(coordinate, scope.center) <= scope.radiusKm;
  if (scope.mode === 'personal') return scope.centers.some(center => (
    memoryDistanceKm(coordinate, center) <= (scope.proximityRequested ? scope.radiusKm : 0.05)
  ));
  if (scope.mode === 'place') return scope.place.boxes.some(([minLat, minLng, maxLat, maxLng]) => (
    coordinate.lat >= minLat && coordinate.lat <= maxLat
      && coordinate.lng >= minLng && coordinate.lng <= maxLng
  ));
  return scope.region.boxes.some(([minLat, minLng, maxLat, maxLng]) => (
    coordinate.lat >= minLat && coordinate.lat <= maxLat
      && coordinate.lng >= minLng && coordinate.lng <= maxLng
  ));
};

const starMatchesScope = (star: StarRow, scope: SpatialScope | null) => {
  const point = pointForStar(star);
  if (!point) return false;
  if (scope?.mode === 'personal' && !scope.proximityRequested) {
    return scope.anchorStarIds.includes(star.id);
  }
  return coordinateInScope(point, scope);
};

const queryNoise = [
  '旅行', '旅游', '旅遊', '出游', '出遊', '度假', '游记', '遊記', '行程',
  'trip', 'travel', 'travels', 'vacation', 'holiday', 'journey', 'tour', 'visit',
  '여행', '휴가', '관광', '旅行', '観光', '休暇',
  '请', '請', '帮我', '幫我', '搜索', '搜尋', '查找', '看看', '回忆', '回憶', '关于', '關於', '我的', '记录', '記錄', '记忆', '記憶',
  'please', 'find', 'search', 'show', 'tell', 'about', 'my', 'memory', 'memories',
  '찾아', '검색', '기억', '기록', '보여', '내', '나의',
];

const residualQuery = (query: string, scope: SpatialScope | null) => {
  if (scope?.mode === 'personal') return '';
  let normalized = normalizeCompact(query)
    .replace(/(?:19|20)\d{2}(?:年(?:\d{1,2}月(?:\d{1,2}(?:日|号|號)?)?)?)?/gu, '')
    .replace(/(?:19|20)\d{6}/gu, '')
    .replace(/(?:19|20)\d{2}/gu, '');
  if (scope?.mode === 'country') {
    const fragments = [scope.matchedAlias, scope.name, scope.code, ...scope.region.aliases]
      .map(normalizeCompact)
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    fragments.forEach(fragment => {
      normalized = normalized.split(fragment).join('');
    });
  }
  if (scope?.mode === 'place') {
    const fragments = [scope.matchedAlias, scope.place.name, scope.place.displayName]
      .map(normalizeCompact)
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    fragments.forEach(fragment => {
      normalized = normalized.split(fragment).join('');
    });
  }
  if (scope?.mode === 'radius') {
    normalized = normalized
      .replace(/-?\d+(?:\.\d+)?/g, '')
      .replace(/(?:km|公里|千米|킬로미터|m|米|미터)/gi, '');
  }
  queryNoise.map(normalizeCompact).filter(Boolean).forEach(fragment => {
    normalized = normalized.split(fragment).join('');
  });
  return normalized;
};

const noteTimestamp = (note: NoteRow, star: StarRow) => {
  const value = Number(note.created_at_ms ?? star.created_at_ms);
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const trackCoordinates = (track: TrackRow) => {
  const paths = Array.isArray(track.paths) ? track.paths : [];
  return paths.flatMap(path => Array.isArray(path) ? path : [])
    .map(point => Array.isArray(point) ? finiteCoordinate(point[0], point[1]) : null)
    .filter((point): point is Coordinate => Boolean(point));
};

const pointForStar = (star: StarRow) => finiteCoordinate(star.lat, star.lng);

const trackMatchesScope = (track: TrackRow, scope: SpatialScope | null) => {
  if (!scope) return true;
  if (scope.mode === 'personal' && !scope.proximityRequested) return false;
  return trackCoordinates(track).some(point => coordinateInScope(point, scope));
};

const clusterEntries = (entries: NoteEntry[], tracks: TrackRow[]) => {
  const sorted = [...entries].filter(entry => entry.timestamp > 0)
    .sort((left, right) => left.timestamp - right.timestamp || left.note.id.localeCompare(right.note.id));
  const groups: NoteEntry[][] = [];
  sorted.forEach(entry => {
    const active = groups.at(-1);
    const last = active?.at(-1);
    if (!active || !last || entry.timestamp - last.timestamp > CLUSTER_GAP_MS) groups.push([entry]);
    else active.push(entry);
  });
  return groups.map((group, index) => {
    const startAt = group[0].timestamp;
    const endAt = group.at(-1)?.timestamp || startAt;
    const starIds = [...new Set(group.map(entry => entry.star.id))];
    const coordinates = [...new Map(group.map(entry => [entry.star.id, pointForStar(entry.star)]))
      .values()].filter((point): point is Coordinate => Boolean(point));
    const center = coordinates.length ? {
      lat: coordinates.reduce((sum, point) => sum + point.lat, 0) / coordinates.length,
      lng: coordinates.reduce((sum, point) => sum + point.lng, 0) / coordinates.length,
    } : null;
    const spreadKm = center
      ? Math.max(0, ...coordinates.map(point => memoryDistanceKm(center, point)))
      : 0;
    const relatedRoutes = tracks.filter(track => {
      const createdAt = Number(track.created_at_ms);
      return Number.isFinite(createdAt)
        && createdAt >= startAt - (12 * 60 * 60 * 1000)
        && createdAt <= endAt + (36 * 60 * 60 * 1000);
    });
    return {
      index,
      startAt,
      endAt,
      durationDays: Math.max(1, Math.floor((endAt - startAt) / DAY_MS) + 1),
      noteCount: group.length,
      locationCount: starIds.length,
      routeCount: relatedRoutes.length,
      approximateSpreadKm: Math.round(spreadKm * 10) / 10,
      sampleNoteIds: group.slice(0, 10).map(entry => entry.note.id),
      sampleStarIds: starIds.slice(0, 10),
    };
  });
};

const classifyContext = ({
  entries,
  clusters,
  latestInScope,
  locationCount,
  trackCount,
}: {
  entries: NoteEntry[];
  clusters: ReturnType<typeof clusterEntries>;
  latestInScope: boolean;
  locationCount: number;
  trackCount: number;
}) => {
  if (!entries.length && trackCount > 0) return {
    label: 'uncertain' as const,
    confidence: 0.35,
    evidence: [
      `${trackCount} matching route record(s) were found, but no matching note was available.`,
      'A route alone is not enough to distinguish travel from daily life.',
    ],
  };
  if (!entries.length && locationCount > 0) return {
    label: 'uncertain' as const,
    confidence: 0.3,
    evidence: [
      `${locationCount} matching saved location(s) were found, but no matching note was available.`,
      'A saved location alone is not enough to distinguish travel from daily life.',
    ],
  };
  if (!entries.length) return {
    label: 'uncertain' as const,
    confidence: 0,
    evidence: ['No matching memory records were found.'],
  };
  const timestamps = entries.map(entry => entry.timestamp).filter(Boolean).sort((a, b) => a - b);
  const spanDays = timestamps.length > 1
    ? Math.max(1, Math.floor(((timestamps.at(-1) || 0) - timestamps[0]) / DAY_MS) + 1)
    : 1;
  const notedLocationCount = new Set(entries.map(entry => entry.star.id)).size;
  if (latestInScope && clusters.length >= 3 && spanDays >= 45) return {
    label: 'daily' as const,
    confidence: 0.78,
    evidence: [
      `The target area appears in ${clusters.length} separated time clusters over ${spanDays} days.`,
      'The latest recorded memory is also inside the target area.',
    ],
  };
  if (clusters.length === 1 && spanDays <= 30 && (notedLocationCount >= 2 || trackCount > 0)) return {
    label: 'travel' as const,
    confidence: latestInScope ? 0.68 : 0.84,
    evidence: [
      `The records form one compact ${spanDays}-day period across ${notedLocationCount} saved locations.`,
      trackCount > 0 ? `${trackCount} related route record(s) support a movement episode.` : 'Multiple saved locations support a movement episode.',
      latestInScope
        ? 'The latest saved memory is in the same area, but this does not establish the user\'s current presence.'
        : 'The latest recorded memory is outside the target area.',
    ],
  };
  if (clusters.length >= 2 && spanDays >= 60) return {
    label: 'mixed' as const,
    confidence: 0.7,
    evidence: [
      `The area appears in ${clusters.length} separated periods over ${spanDays} days.`,
      'This may represent repeated trips or an area connected to ordinary life; the records do not support a single definitive label.',
    ],
  };
  if (latestInScope && spanDays >= 30) return {
    label: 'daily' as const,
    confidence: 0.62,
    evidence: [
      `The target area spans ${spanDays} days and includes the latest recorded memory.`,
      'The evidence leans toward an ongoing or ordinary-life context, but remains inferential.',
    ],
  };
  return {
    label: 'uncertain' as const,
    confidence: 0.4,
    evidence: [
      `Only ${entries.length} matching note(s) across ${notedLocationCount} location(s) were available.`,
      'The available time and movement evidence is not sufficient to distinguish travel from daily life.',
    ],
  };
};

const publicScope = (scope: SpatialScope | null) => {
  if (!scope) return null;
  if (scope.mode === 'personal') return {
    mode: scope.mode,
    status: scope.resolution.status,
    relations: scope.resolution.relations,
    confidence: scope.resolution.confidence,
    matchSource: scope.resolution.matchSource,
    proximityRequested: scope.proximityRequested,
    radiusKm: scope.proximityRequested ? scope.radiusKm : null,
    anchorStarIds: scope.anchorStarIds,
  };
  if (scope.mode === 'radius') return {
    mode: scope.mode,
    center: scope.center,
    radiusKm: scope.radiusKm,
    matchedAlias: scope.matchedAlias,
  };
  if (scope.mode === 'place') return {
    mode: scope.mode,
    name: scope.place.name,
    displayName: scope.place.displayName,
    type: scope.place.type,
    countryCode: scope.place.countryCode,
    center: scope.place.center,
    boxes: scope.place.boxes,
    provider: scope.place.provider,
    attribution: scope.place.attribution,
    matchedAlias: scope.matchedAlias,
  };
  return {
    mode: scope.mode,
    code: scope.code,
    name: scope.name,
    matchedAlias: scope.matchedAlias,
  };
};

const resolutionFromUserConfirmation = ({
  memory,
  base,
  queryPlan,
  confirmed,
}: {
  memory: NormalizedMemoryRows;
  base: PersonalContextResolution;
  queryPlan: ReturnType<typeof buildMemoryQueryPlan>;
  confirmed: ConfirmedMemoryReference | null | undefined;
}): PersonalContextResolution => {
  if (!confirmed) return base;
  const note = memory.notes.find(candidate => candidate.id === confirmed.noteId);
  const star = memory.stars.find(candidate => candidate.id === confirmed.starId);
  if (!note || !star || note.star_id !== star.id) return base;
  const anchorRelation = confirmed.relation === 'home'
    || confirmed.relation === 'work'
    || confirmed.relation === 'study';
  const eventRelation = confirmed.relation === 'observation'
    || confirmed.relation === 'activity';
  const allowed = anchorRelation
    ? queryPlan.anchorRelations.includes(confirmed.relation as 'home' | 'work' | 'study')
    : queryPlan.eventRelations.includes(confirmed.relation as 'observation' | 'activity')
      || queryPlan.targetTerms.length > 0
      || queryPlan.referenceIntent.deictic;
  if (!allowed) return base;
  const createdAt = note.created_at_ms ?? star.created_at_ms;
  const passage: MemoryEvidencePassage = {
    noteId: note.id,
    starId: star.id,
    source: 'reference',
    text: String(confirmed.label || 'User-confirmed memory reference').slice(0, 240),
    relation: confirmed.relation,
    evidenceStrength: 'corroborating',
    attribution: 'user',
    negated: false,
    matchedTerms: [...new Set([
      ...queryPlan.targetTerms,
      ...queryPlan.actionTerms,
      confirmed.label,
    ].map(value => String(value || '').trim()).filter(Boolean))],
    createdAt,
    coordinates: { lat: star.lat, lng: star.lng },
    reviewSource: 'user-confirmed-reference',
  };
  return {
    ...base,
    requested: true,
    status: 'resolved',
    relations: [...new Set([...base.relations, confirmed.relation])],
    anchorRelations: anchorRelation
      ? [...new Set([...base.anchorRelations, confirmed.relation as 'home' | 'work' | 'study'])]
      : base.anchorRelations,
    eventRelations: eventRelation
      ? [...new Set([...base.eventRelations, confirmed.relation as 'observation' | 'activity'])]
      : base.eventRelations,
    confidence: 0.72,
    confidenceBand: 'medium',
    matchSource: 'reference',
    anchors: [{
      starId: star.id,
      noteId: note.id,
      coordinates: { lat: star.lat, lng: star.lng },
      createdAt,
      score: 6,
      matchedRelations: [confirmed.relation],
      matchedTerms: passage.matchedTerms,
    }],
    episodes: anchorRelation ? [{
      relation: confirmed.relation as 'home' | 'work' | 'study',
      starId: star.id,
      evidenceNoteIds: [note.id],
      firstEvidenceAt: createdAt,
      lastEvidenceAt: createdAt,
      evidenceStrength: 'corroborated',
    }] : [],
    evidencePassages: [passage],
    evidenceNoteIds: [note.id],
    decisionReasons: ['The user explicitly confirmed this opaque reference option for the current query.'],
    instruction: 'Answer from this user-confirmed reference only for the current query. Do not generalize it into a permanent identity fact.',
  };
};

export const researchMemoryContext = (
  memory: NormalizedMemoryRows,
  input: MemoryResearchInput,
  timeZone = 'UTC',
  now = new Date(),
) => {
  const query = String(input.query || '').trim();
  const countryHint = resolveMemoryCountryRegion(query);
  const queryPlan = buildMemoryQueryPlan({
    query,
    publicPlace: String(input.place || input.region || countryHint?.matchedAlias || ''),
    publicPlaceSource: input.placeSource || (input.place || input.region ? 'explicit-argument' : 'query-span'),
    dateFrom: String(input.dateFrom || ''),
    dateTo: String(input.dateTo || ''),
    radiusProvided: input.radiusKm !== undefined || parseRadiusKm(query) !== null,
  });
  const inferredDateRange = inferMemoryQueryDateRange(query);
  const dateFrom = String(queryPlan.dateRange?.dateFrom || '');
  const dateTo = String(queryPlan.dateRange?.dateTo || '');
  const temporalContext = buildMemoryTemporalContext(timeZone, now);
  const temporalResolutionRequired = queryPlan.relativeTimeNeedsResolution;
  const unresolvedPublicPlace = Boolean(
    queryPlan.publicPlace
    && !input.resolvedPlace
    && input.placeResolution
    && ['ambiguous', 'not-found', 'unavailable'].includes(input.placeResolution.status),
  );
  const resolvedSpatialScope = resolveSpatialScope(input);
  const starById = new Map(memory.stars.map(star => [star.id, star]));
  const personalArchive = temporalResolutionRequired || unresolvedPublicPlace ? {
    ...memory,
    stars: [],
    notes: [],
    tracks: [],
  } : (dateFrom || dateTo || resolvedSpatialScope) ? {
    ...memory,
    notes: memory.notes.filter(note => {
      const star = starById.get(note.star_id);
      if (!star || !starMatchesScope(star, resolvedSpatialScope)) return false;
      const timestamp = noteTimestamp(note, star);
      return (!dateFrom && !dateTo) || isInDateRange(timestamp, dateFrom, dateTo, timeZone);
    }),
  } : memory;
  const personalRadius = clampRadiusKm(input.radiusKm ?? parseRadiusKm(query) ?? DEFAULT_RADIUS_KM);
  const deterministicPersonalContext = resolvePersonalMemoryContext(
    personalArchive,
    [query, input.place, input.region].filter(Boolean).join(' '),
    personalRadius,
  );
  const candidateReview = buildBoundedArchiveReview(personalArchive, deterministicPersonalContext);
  const personalContext = resolutionFromUserConfirmation({
    memory: personalArchive,
    base: deterministicPersonalContext,
    queryPlan,
    confirmed: input.confirmedReference,
  });
  const personalScope: PersonalScope | null = (
    personalContext.status === 'resolved' || personalContext.status === 'ambiguous'
  ) ? {
      mode: 'personal',
      anchorStarIds: personalContext.anchors.map(anchor => anchor.starId),
      centers: personalContext.anchors.map(anchor => anchor.coordinates),
      radiusKm: personalContext.radiusKm,
      proximityRequested: personalContext.status === 'resolved' && personalContext.proximityRequested,
      resolution: personalContext,
    } : null;
  const unresolvedPersonalContext = personalContext.status === 'not-found';
  const ambiguousPersonalContext = personalContext.status === 'ambiguous';
  const scope = resolvedSpatialScope || (personalContext.requested ? personalScope : null);
  const residual = personalContext.requested ? '' : residualQuery(query, scope);
  const evidenceNoteIds = new Set(personalContext.evidenceNoteIds);
  const requiresTargetEvidence = personalContext.requested && (
    queryPlan.eventRelations.length > 0 || queryPlan.targetTerms.length > 0
  );
  const routeOnlyPersonalQuery = personalContext.requested
    && queryPlan.anchorRelations.length > 0
    && queryPlan.routeIntent
    && !requiresTargetEvidence;
  const spatialStars = temporalResolutionRequired || unresolvedPublicPlace || unresolvedPersonalContext
    ? []
    : memory.stars.filter(star => starMatchesScope(star, scope));
  const spatialStarIds = new Set(spatialStars.map(star => star.id));
  const allEntries = memory.notes.flatMap(note => {
    if (temporalResolutionRequired || unresolvedPublicPlace || unresolvedPersonalContext) return [];
    const star = starById.get(note.star_id);
    if (!star) return [];
    if (!spatialStarIds.has(star.id)) return [];
    if (ambiguousPersonalContext && !evidenceNoteIds.has(note.id)) return [];
    const timestamp = noteTimestamp(note, star);
    if ((dateFrom || dateTo) && !isInDateRange(timestamp, dateFrom, dateTo, timeZone)) return [];
    const deterministicTargetEvidence = requiresTargetEvidence
      ? findTargetEvidencePassages(note, star, personalContext)
      : [];
    const confirmedTargetEvidence = requiresTargetEvidence
      ? personalContext.evidencePassages.filter(passage => (
        passage.noteId === note.id
        && passage.reviewSource === 'user-confirmed-reference'
        && personalContext.eventRelations.includes(passage.relation as 'observation' | 'activity')
      ))
      : [];
    const targetEvidence = [...deterministicTargetEvidence, ...confirmedTargetEvidence]
      .filter((passage, index, passages) => passages.findIndex(candidate => (
        candidate.noteId === passage.noteId
        && candidate.relation === passage.relation
        && normalizeCompact(candidate.text) === normalizeCompact(passage.text)
      )) === index);
    if (requiresTargetEvidence && !targetEvidence.length) return [];
    if (personalContext.requested && !queryPlan.anchorRelations.length && !evidenceNoteIds.has(note.id)) return [];
    if (routeOnlyPersonalQuery && !evidenceNoteIds.has(note.id)) return [];
    if (personalContext.requested && queryPlan.anchorRelations.length && !personalContext.proximityRequested
      && !requiresTargetEvidence && queryPlan.answerIntent === 'locate' && !evidenceNoteIds.has(note.id)) return [];
    const searchable = normalizeCompact(`${noteTitle(note)} ${noteText(note)} ${star.id} ${star.lat},${star.lng}`);
    const textScore = personalContext.requested
      ? targetEvidence.length
        ? Math.max(...targetEvidence.map(passage => (
          passage.evidenceStrength === 'direct' ? 30 : passage.evidenceStrength === 'corroborating' ? 20 : 10
        ))) + Number(targetEvidence.some(passage => passage.source === 'title'))
        : (evidenceNoteIds.has(note.id) ? 10 : 0)
      : residual && searchable.includes(residual) ? 1 : 0;
    if (!scope && residual && textScore === 0) return [];
    return [{ note, star, timestamp, textScore, targetEvidence }];
  });
  allEntries.sort((left, right) => right.textScore - left.textScore
    || right.timestamp - left.timestamp || left.note.id.localeCompare(right.note.id));

  const entryStarIds = new Set(allEntries.map(entry => entry.star.id));
  const personalAnchorStarIds = new Set(personalContext.anchors.map(anchor => anchor.starId));
  const matchingStars = (personalContext.requested
    ? spatialStars.filter(star => entryStarIds.has(star.id) || personalAnchorStarIds.has(star.id))
    : scope || !residual
      ? spatialStars.filter(star => {
        if (!dateFrom && !dateTo) return true;
        return entryStarIds.has(star.id)
          || isInDateRange(star.created_at_ms, dateFrom, dateTo, timeZone);
      })
      : spatialStars.filter(star => entryStarIds.has(star.id)))
    .sort((left, right) => Number(right.created_at_ms || 0) - Number(left.created_at_ms || 0)
      || left.id.localeCompare(right.id));

  const allLatestEntry = temporalResolutionRequired || unresolvedPublicPlace ? null : memory.notes.flatMap(note => {
    const star = starById.get(note.star_id);
    if (!star) return [];
    return [{ note, star, timestamp: noteTimestamp(note, star) }];
  }).filter(entry => entry.timestamp > 0)
    .sort((left, right) => right.timestamp - left.timestamp)[0] || null;
  const latestPoint = allLatestEntry ? pointForStar(allLatestEntry.star) : null;
  const latestInScope = Boolean(latestPoint && scope && coordinateInScope(latestPoint, scope));

  const allowPersonalTracks = !personalContext.requested || (
    personalContext.status === 'resolved'
    && personalContext.proximityRequested
    && queryPlan.routeIntent
  );
  let matchingTracks = (temporalResolutionRequired || unresolvedPublicPlace || !allowPersonalTracks ? [] : memory.tracks).filter(track => {
    if (!trackMatchesScope(track, scope)) return false;
    if ((dateFrom || dateTo) && !isInDateRange(track.created_at_ms, dateFrom, dateTo, timeZone)) return false;
    return true;
  });
  if (!scope && !dateFrom && !dateTo) {
    const datedEntries = allEntries.filter(entry => entry.timestamp > 0);
    matchingTracks = matchingTracks.filter(track => {
      const createdAt = Number(track.created_at_ms);
      return Number.isFinite(createdAt) && datedEntries.some(entry => (
        createdAt >= entry.timestamp - (12 * 60 * 60 * 1000)
          && createdAt <= entry.timestamp + (36 * 60 * 60 * 1000)
      ));
    });
  }
  matchingTracks.sort((left, right) => Number(right.created_at_ms || 0) - Number(left.created_at_ms || 0));

  const chronologicalEntries = [...allEntries].sort((left, right) => left.timestamp - right.timestamp);
  const clusters = clusterEntries(chronologicalEntries, matchingTracks);
  const rawClassification = personalContext.requested ? {
    label: 'uncertain' as const,
    confidence: 0,
    evidence: personalContext.status === 'resolved'
      ? ['A personal memory relation was resolved from the user\'s own note evidence.', 'That relation alone does not establish travel or daily-life context.']
      : personalContext.status === 'ambiguous'
        ? ['Multiple evidence-backed personal locations were found.', 'The user must disambiguate before nearby memories are interpreted.']
        : ['No note supplied direct evidence for the requested personal context.'],
  } : classifyContext({
      entries: allEntries,
      clusters,
      latestInScope,
      locationCount: matchingStars.length,
      trackCount: matchingTracks.length,
    });
  const classification = {
    ...rawClassification,
    confidenceKind: 'heuristic' as const,
    confidenceBand: confidenceBandFor(rawClassification.confidence),
  };
  const limit = Math.min(MAX_RETURNED_NOTES, Math.max(1, Number(input.limit) || 30));
  const selectedEntries = allEntries.slice(0, limit);
  const selectedStarIds = [...new Set([
    ...selectedEntries.map(entry => entry.star.id),
    ...matchingStars.slice(0, MAX_RETURNED_LOCATIONS).map(star => star.id),
  ])].slice(0, MAX_RETURNED_LOCATIONS);
  const hasMatchingRecords = allEntries.length > 0 || matchingStars.length > 0 || matchingTracks.length > 0;
  const instruction = temporalResolutionRequired
    ? `The query contains a relative date that has not been converted into dateFrom/dateTo. Use temporalContext (${temporalContext.currentLocalDate}, ${temporalContext.timeZone}) to calculate a bounded range, then retry; do not search all history.`
    : unresolvedPublicPlace
      ? input.placeResolution?.status === 'ambiguous'
        ? 'The explicit public place has multiple plausible resolutions. Present the bounded place candidates and ask the user to disambiguate; do not search or merge unrelated locations.'
        : 'The explicit public place could not be resolved. Report that place resolution failed and do not substitute unrelated memories.'
    : personalContext.status === 'ambiguous'
    ? personalContext.instruction
    : unresolvedPersonalContext && candidateReview.available
      ? candidateReview.instruction
      : unresolvedPersonalContext
        ? personalContext.instruction
        : personalContext.status === 'resolved'
          ? `${personalContext.instruction} Answer only from records and anchor evidence returned for this personal context.`
          : hasMatchingRecords
            ? 'Use only the returned records. Classification is an inference, not a stored fact.'
            : 'No matching records after geographic and temporal retrieval. Do not infer or invent.';

  const seenAnchorEvidence = new Set<string>();
  const anchorEvidence: ResearchEvidencePassage[] = personalContext.evidencePassages
    .filter(passage => (
      passage.relation === 'home' || passage.relation === 'work' || passage.relation === 'study'
    ))
    .map(passage => {
      const anchorKey = `${passage.relation}:${passage.starId}`;
      const role = seenAnchorEvidence.has(anchorKey) ? 'corroboration' as const : 'anchor' as const;
      seenAnchorEvidence.add(anchorKey);
      return { ...passage, role };
    });
  const targetEvidence: ResearchEvidencePassage[] = selectedEntries.flatMap(entry => (
    entry.targetEvidence.map(passage => ({ ...passage, role: 'target' as const }))
  ));
  const evidenceSeen = new Set<string>();
  const uniqueEvidence = (passages: ResearchEvidencePassage[]) => passages.filter(passage => {
    const key = `${passage.noteId}:${normalizeCompact(passage.text)}:${passage.role}`;
    if (evidenceSeen.has(key)) return false;
    evidenceSeen.add(key);
    return true;
  });
  const uniqueTargets = uniqueEvidence(targetEvidence);
  const uniqueAnchors = uniqueEvidence(anchorEvidence);
  const evidencePassages = (uniqueTargets.length ? [
    ...uniqueTargets.slice(0, 10),
    ...uniqueAnchors.slice(0, 2),
    ...uniqueTargets.slice(10),
    ...uniqueAnchors.slice(2),
  ] : uniqueAnchors).slice(0, 12);
  const evidencePassageNoteIds = new Set(evidencePassages.map(passage => passage.noteId));
  const selectedNoteIds = selectedEntries.map(entry => entry.note.id);
  const selectedImageNoteIds = selectedEntries
    .filter(entry => evidencePassageNoteIds.has(entry.note.id) && noteHasImages(entry.note))
    .map(entry => entry.note.id);
  const decisionReasons = [
    ...(temporalResolutionRequired ? ['Relative time requires an exact user-local date range before archive retrieval.'] : []),
    ...personalContext.decisionReasons,
    ...(requiresTargetEvidence && selectedEntries.length
      ? ['Target records passed the resolved spatial scope and contained supported target/action evidence.']
      : []),
    ...(allowPersonalTracks && matchingTracks.length
      ? ['Routes were included only after one nearby personal anchor resolved and route intent was explicit.']
      : []),
  ];
  const answerBoundary = buildMemoryAnswerBoundary({
    queryPlan,
    personalContext,
    temporalResolutionRequired,
    unresolvedPublicPlace,
    semanticReviewRequired: false,
    semanticClarification: null,
    hasMatchingRecords,
    verifiedPlaceNames: input.resolvedPlace
      ? [input.resolvedPlace.displayName || input.resolvedPlace.name].filter(Boolean)
      : [],
    evidenceNoteIds: evidencePassages.map(passage => passage.noteId),
  });

  return {
    query,
    answerBoundary,
    queryPlan,
    temporalContext,
    timestampSemantics: {
      currentLocalDateRole: 'query-evaluation-clock' as const,
      createdAtRole: 'memory-creation-time' as const,
      updatedAtRole: 'storage-mutation-time-not-proof-of-user-edit' as const,
      instruction: 'Use currentLocalDate only to resolve relative query dates. A note happened on createdAt. updatedAt is a storage mutation timestamp and must not be described as a deliberate user edit.',
    },
    semanticReview: {
      required: false,
      phase: 'not-needed' as const,
      usesExternalModelService: false as const,
      candidatesExposed: false,
      instruction: 'Host-model candidate verdicts are not accepted as evidence. Fuzzy references require explicit user confirmation.',
    },
    searchPlan: {
      mode: personalContext.status === 'resolved'
        ? (personalContext.proximityRequested ? 'personal-nearby' : 'personal-context')
        : personalContext.status === 'ambiguous'
          ? 'personal-context-ambiguous'
          : unresolvedPersonalContext
            ? (candidateReview.available ? 'personal-context-candidate-review' : 'personal-context-unresolved')
            : unresolvedPublicPlace
              ? (input.placeResolution?.status === 'ambiguous' ? 'public-place-ambiguous' : 'public-place-unresolved')
              : scope?.mode || (residual ? 'text' : 'timeline'),
      resolvedRegion: publicScope(scope),
      requestedPlace: String(input.place || '').trim() || null,
      placeResolution: input.placeResolution || { status: 'not-requested' },
      residualTextQuery: residual,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      inferredDateRange: !input.dateFrom && !input.dateTo ? inferredDateRange : null,
      geographicFallbackUsed: Boolean(scope),
      temporalClusteringUsed: !unresolvedPersonalContext,
      titleFirstReviewUsed: candidateReview.available,
      relativeTimeNeedsResolution: temporalResolutionRequired,
    },
    personalContext,
    evidencePassages,
    confidenceKind: 'heuristic' as const,
    confidenceBand: personalContext.requested
      ? personalContext.confidenceBand
      : classification.confidenceBand,
    decisionReasons,
    candidateReview,
    candidateScopeNoteIds: personalArchive.notes.map(note => note.id),
    latestRecordedMemory: !personalContext.requested && allLatestEntry ? {
      noteId: allLatestEntry.note.id,
      starId: allLatestEntry.star.id,
      createdAt: allLatestEntry.timestamp,
      coordinates: latestPoint,
      relationToSearchArea: scope ? (latestInScope ? 'inside' : 'outside') : 'not-evaluated',
      caution: 'This is the latest saved memory, not verified current location.',
    } : null,
    classification,
    clusters,
    totals: {
      notes: allEntries.length,
      locations: matchingStars.length,
      routes: matchingTracks.length,
    },
    selectedNoteIds,
    selectedImageNoteIds,
    selectedStarIds,
    selectedTrackIds: matchingTracks.slice(0, MAX_RETURNED_ROUTES).map(track => track.id),
    titleNoteIds: candidateReview.titleNoteIds,
    candidateNoteIds: candidateReview.candidateNoteIds,
    instruction,
  };
};
