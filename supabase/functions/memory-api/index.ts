import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  clientIp,
  createCorsHeaders,
  forbiddenOriginResponse,
  hitRateLimit,
  isOriginAllowed,
  rateLimitResponse,
  sanitizeHtmlFields,
  sanitizeRichHtml,
  tokenPrefix,
} from '../_shared/security.ts';
import {
  applyAuthenticatedMemoryMutations,
  loadNormalizedMemoryRows,
  type MemoryMutationWire,
  type NormalizedMemoryLoadOptions,
  type NoteRow,
  type StarRow,
  type TrackRow,
} from '../_shared/normalized-memory.ts';
import {
  buildMemoryReportHtml,
  dateKeyFor,
  getArray,
  getBoolean,
  getNumber,
  getString,
  isFiniteCoordinate,
  isInDateRange,
  noteSummary,
  notesByStarId,
  routeSummary,
  starSummary,
} from '../_shared/memory-presenters.ts';
import { resolveMemoryPlace } from '../_shared/memory-place-resolver.ts';
import {
  researchMemoryContext,
  resolveExactMemoryCountryRegion,
  resolveMemoryCountryRegion,
  type MemoryPlaceResolutionSummary,
  type ResolvedMemoryPlace,
} from '../_shared/memory-research.ts';
import {
  explicitMemoryNoteTitle,
  isPersonalMemoryReference,
} from '../_shared/memory-personal-context.ts';
import { collectMemoryImageReferences } from '../_shared/memory-image-references.ts';

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://kakizzzzz.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const writeActions = new Set([
  'create_star',
  'update_star',
  'add_note_to_star',
  'update_note',
  'delete_note',
  'delete_star',
  'delete_route',
]);

const writableNoteKeys = new Set([
  'title', 'titleHtml', 'content', 'contentHtml', 'imageUrl', 'imageUrls',
  'images', 'fontSize', 'titleFontSize', 'color',
]);
const writableStarKeys = new Set(['lat', 'lng', 'color', 'tagOrder', 'tagGroupId']);
const sensitiveKeys = new Set([
  'password', 'loginpassword', 'registerpassword', 'currentpassword',
  'newpassword', 'confirmpassword', 'invitecode',
]);

const DAY_MS = 86_400_000;
const broadDatabaseDateRange = (dateFrom = '', dateTo = '') => {
  const fromUtc = /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)
    ? Date.parse(`${dateFrom}T00:00:00Z`) - (2 * DAY_MS)
    : undefined;
  const toUtc = /^\d{4}-\d{2}-\d{2}$/.test(dateTo)
    ? Date.parse(`${dateTo}T00:00:00Z`) + (3 * DAY_MS)
    : undefined;
  return {
    fromMs: Number.isFinite(fromUtc) ? fromUtc : undefined,
    beforeMs: Number.isFinite(toUtc) ? toUtc : undefined,
  };
};

const requestedNoteIds = (body: Record<string, unknown>) => (
  Array.isArray(body.noteIds)
    ? [...new Set(body.noteIds
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean))]
    : []
);

const hasValidNoteIds = (body: Record<string, unknown>, noteIds: string[]) => (
  Array.isArray(body.noteIds)
  && noteIds.length >= 1
  && noteIds.length <= 10
  && noteIds.length === body.noteIds.length
  && noteIds.every(noteId => noteId.length <= 200)
);

const memoryLoadOptions = (action: string, body: Record<string, unknown>): NormalizedMemoryLoadOptions => {
  const date = getString(body.date);
  const dateFrom = date || getString(body.dateFrom);
  const dateTo = date || getString(body.dateTo);
  const range = broadDatabaseDateRange(dateFrom, dateTo);
  if (action === 'list_locations') {
    return { includeProfile: false, includeTracks: false };
  }
  if (action === 'search_memories' || action === 'get_day_memory') {
    return {
      includeProfile: false,
      includeTracks: false,
      noteCreatedFromMs: range.fromMs,
      noteCreatedBeforeMs: range.beforeMs,
    };
  }
  if (action === 'get_location_memory') {
    return {
      includeProfile: false,
      includeTracks: false,
      starId: getString(body.starId),
    };
  }
  if (action === 'get_routes') {
    return {
      includeProfile: false,
      includeStars: false,
      includeNotes: false,
      trackCreatedFromMs: range.fromMs,
      trackCreatedBeforeMs: range.beforeMs,
    };
  }
  if (action === 'research_memory_context') {
    return { includeProfile: false };
  }
  if (action === 'get_note_media') {
    return {
      includeProfile: false,
      includeStars: false,
      includeTracks: false,
      noteIds: requestedNoteIds(body),
    };
  }
  return {};
};

const jsonResponse = (
  body: unknown,
  status = 200,
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const errorResponse = (
  code: string,
  message: string,
  status: number,
  corsHeaders: Record<string, string>,
  extra: Record<string, unknown> = {},
) => jsonResponse({ error: { code, message, ...extra } }, status, corsHeaders);

const memoryResponse = (
  action: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
  count: number,
  query = '',
) => jsonResponse({
  ok: true,
  source: 'my-life-memory-normalized-v2',
  action,
  query,
  timestamp: new Date().toISOString(),
  ...(count === 0 ? {
    records: [],
    instruction: 'No matching records. Do not infer or invent.',
  } : {}),
  ...body,
  count,
}, 200, corsHeaders);

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;
  const sanitized: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (!sensitiveKeys.has(key.toLowerCase())) sanitized[key] = sanitizeValue(entry);
  });
  return sanitizeHtmlFields(sanitized);
};

const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const requireWriteIntent = (body: Record<string, unknown>, corsHeaders: Record<string, string>) => {
  if (!getBoolean(body.confirmWrite)) {
    throw errorResponse('write_confirmation_required', 'Set confirmWrite to true before changing memories.', 400, corsHeaders);
  }
};

const requireDeleteIntent = (body: Record<string, unknown>, corsHeaders: Record<string, string>) => {
  requireWriteIntent(body, corsHeaders);
  if (body.confirm !== 'DELETE') {
    throw errorResponse('delete_confirmation_required', 'Set confirm to DELETE before deleting memories.', 400, corsHeaders);
  }
};

const starPayload = (star: StarRow, overrides: Record<string, unknown> = {}) => ({
  id: star.id,
  sortOrder: star.sort_order,
  lat: star.lat,
  lng: star.lng,
  createdAt: star.created_at_ms,
  tagOrder: star.tag_order,
  tagGroupId: star.tag_group_id,
  color: star.color,
  ...overrides,
});

const notePayload = (note: NoteRow, overrides: Record<string, unknown> = {}) => ({
  id: note.id,
  starId: note.star_id,
  sortOrder: note.sort_order,
  title: note.title,
  titleHtml: note.title_html,
  content: note.content,
  contentHtml: note.content_html,
  imageUrl: note.image_url,
  imageUrls: note.image_urls || [],
  images: note.images || [],
  fontSize: note.font_size,
  titleFontSize: note.title_font_size,
  color: note.color,
  createdAt: note.created_at_ms,
  updatedAt: note.updated_at_ms,
  ...overrides,
});

const applyWrite = async ({
  supabaseUrl,
  anonKey,
  accessToken,
  revision,
  mutations,
}: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  revision: number;
  mutations: MemoryMutationWire[];
}) => applyAuthenticatedMemoryMutations({
  supabaseUrl,
  anonKey,
  accessToken,
  expectedRevision: revision,
  mutations,
});

serve(async request => {
  if (!isOriginAllowed(request)) return forbiddenOriginResponse();
  const corsHeaders = createCorsHeaders(request);
  const fail = (code: string, message: string, status = 400, extra: Record<string, unknown> = {}) => (
    errorResponse(code, message, status, corsHeaders, extra)
  );

  const ipLimit = await hitRateLimit(`memory-api:${clientIp(request)}`, 180, 60_000);
  if (ipLimit.limited) return rateLimitResponse(corsHeaders, ipLimit.retryAfterSeconds);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return fail('method_not_allowed', 'Method not allowed.', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const internalToken = Deno.env.get('MEMORY_API_INTERNAL_TOKEN') || '';
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return fail('setup_required', 'Memory API is not configured.', 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail('bad_request', 'Invalid request body.', 400);
  }

  const admin = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const action = getString(body.action);
    const authorization = request.headers.get('authorization') || '';
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const internalHeader = request.headers.get('x-memory-api-internal-token') || '';
    const authLimit = await hitRateLimit(
      `memory-api-auth:${clientIp(request)}:${tokenPrefix(internalHeader || accessToken)}`,
      120,
      60_000,
    );
    if (authLimit.limited) return rateLimitResponse(corsHeaders, authLimit.retryAfterSeconds);

    let userId = '';
    let internalRequest = false;
    if (internalHeader) {
      if (!internalToken || internalHeader !== internalToken) return fail('unauthorized', 'Invalid internal Memory API token.', 401);
      userId = getString(body.userId);
      internalRequest = true;
      if (!userId) return fail('bad_request', 'Internal Memory API requests require userId.', 400);
    } else {
      const { data, error } = await admin.auth.getUser(accessToken);
      if (error || !data.user) return fail('unauthorized', 'A valid user token is required.', 401);
      userId = data.user.id;
    }

    if (writeActions.has(action)) {
      if (internalRequest) return fail('writes_disabled', 'Internal and MCP requests are read-only.', 403);
      if ((Deno.env.get('ENABLE_MEMORY_API_WRITES') || '').toLowerCase() !== 'true') {
        return fail('writes_disabled', 'Memory API write actions are disabled in production.', 403);
      }
    }

    const timeZone = getString(body.timeZone, 'Asia/Shanghai');
    if (action === 'summarize_memory_range') {
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      if ((dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))
        || (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo))) {
        return fail('bad_request', 'dateFrom and dateTo must be YYYY-MM-DD.', 400);
      }
      const { data, error } = await admin.rpc('summarize_normalized_memory_range', {
        p_user_id: userId,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_time_zone: timeZone,
      });
      if (error) throw error;
      const summary = data && typeof data === 'object' ? data as Record<string, unknown> : {};
      const totals = summary.totals && typeof summary.totals === 'object'
        ? summary.totals as Record<string, unknown>
        : {};
      return memoryResponse(
        action,
        summary,
        corsHeaders,
        Math.max(0, getNumber(totals.notes)),
      );
    }

    const mediaNoteIds = action === 'get_note_media' ? requestedNoteIds(body) : [];
    if (action === 'get_note_media' && !hasValidNoteIds(body, mediaNoteIds)) {
      return fail('bad_request', 'Provide between 1 and 10 unique noteIds.', 400);
    }

    const memory = await loadNormalizedMemoryRows(admin, userId, '', memoryLoadOptions(action, body));
    const groupedNotes = notesByStarId(memory.notes);
    const output = (payload: Record<string, unknown>, count: number, query = '') => (
      memoryResponse(action, payload, corsHeaders, count, query)
    );

    if (action === 'list_locations') {
      const locations = memory.stars.map((star, index) => starSummary(star, index, groupedNotes.get(star.id) || []));
      return output({ locations, records: locations }, locations.length);
    }

    if (action === 'get_note_media') {
      const media = collectMemoryImageReferences(memory.notes, userId);
      return output({ media, records: media }, media.length);
    }

    if (action === 'search_memories') {
      const query = getString(body.query).trim();
      const lowerQuery = query.toLowerCase();
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      const limit = Math.min(Math.max(getNumber(body.limit, 20), 1), 100);
      const starIndex = new Map(memory.stars.map((star, index) => [star.id, index]));
      const starById = new Map(memory.stars.map(star => [star.id, star]));
      const results = memory.notes.flatMap(note => {
        const star = starById.get(note.star_id);
        if (!star) return [];
        const notes = groupedNotes.get(star.id) || [];
        const summary = noteSummary(note, star, starIndex.get(star.id) || 0, notes.findIndex(item => item.id === note.id), query);
        const timestamp = summary.createdAt;
        if ((dateFrom || dateTo) && !isInDateRange(timestamp, dateFrom, dateTo, timeZone)) return [];
        if (lowerQuery) {
          const coordinateText = `${star.lat},${star.lng}`;
          if (!`${summary.title} ${summary.text} ${star.id} ${coordinateText}`.toLowerCase().includes(lowerQuery)) return [];
        }
        return [summary];
      }).slice(0, limit);
      return output({ query, results, records: results }, results.length, query);
    }

    if (action === 'research_memory_context') {
      const query = getString(body.query).trim();
      const place = getString(body.place).trim();
      const region = getString(body.region).trim();
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      if (!query && !place && !region) {
        return fail('bad_request', 'query, place, or region is required.', 400);
      }
      if ((dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom))
        || (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo))) {
        return fail('bad_request', 'dateFrom and dateTo must be YYYY-MM-DD.', 400);
      }
      const hasCenterLat = body.centerLat !== undefined && body.centerLat !== null;
      const hasCenterLng = body.centerLng !== undefined && body.centerLng !== null;
      if (hasCenterLat !== hasCenterLng) {
        return fail('bad_request', 'centerLat and centerLng must be provided together.', 400);
      }
      const centerLat = hasCenterLat ? Number(body.centerLat) : undefined;
      const centerLng = hasCenterLng ? Number(body.centerLng) : undefined;
      if (hasCenterLat && !isFiniteCoordinate(centerLat, centerLng)) {
        return fail('bad_request', 'centerLat and centerLng must be valid coordinates.', 400);
      }
      const radiusKm = body.radiusKm === undefined || body.radiusKm === null
        ? undefined
        : Number(body.radiusKm);
      if (radiusKm !== undefined && (!Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 1_000)) {
        return fail('bad_request', 'radiusKm must be between 0.1 and 1000.', 400);
      }
      const limit = Math.min(Math.max(getNumber(body.limit, 30), 1), 100);
      const requestedPlace = place || (
        region && !resolveExactMemoryCountryRegion(region) ? region : ''
      );
      if (requestedPlace.length > 160) return fail('bad_request', 'place must be 160 characters or fewer.', 400);
      const privatePlaceReference = isPersonalMemoryReference(requestedPlace);
      const geocodablePlace = privatePlaceReference ? '' : requestedPlace;

      let resolvedPlace: ResolvedMemoryPlace | null = null;
      let placeResolution: MemoryPlaceResolutionSummary = privatePlaceReference ? {
        status: 'not-requested',
        query: requestedPlace,
        message: 'Private personal-place references are resolved only from the authenticated user memory archive.',
      } : { status: 'not-requested' };
      let placeCandidates: unknown[] = [];
      const placeAsCountry = resolveExactMemoryCountryRegion(geocodablePlace);
      if (geocodablePlace && !placeAsCountry && !hasCenterLat) {
        const starById = new Map(memory.stars.map(star => [star.id, star]));
        const latestNote = [...memory.notes]
          .filter(note => Number.isFinite(Number(note.created_at_ms)))
          .sort((left, right) => Number(right.created_at_ms || 0) - Number(left.created_at_ms || 0))[0];
        const latestStar = latestNote ? starById.get(latestNote.star_id) : null;
        const country = resolveMemoryCountryRegion(region)
          || resolveMemoryCountryRegion(geocodablePlace);
        const resolution = await resolveMemoryPlace({
          place: geocodablePlace,
          countryCode: country?.region.code,
          memoryCoordinates: memory.stars.map(star => ({ lat: star.lat, lng: star.lng })),
          latestCoordinate: latestStar ? { lat: latestStar.lat, lng: latestStar.lng } : null,
          endpoint: Deno.env.get('MEMORY_GEOCODER_URL') || undefined,
          userAgent: Deno.env.get('MEMORY_GEOCODER_USER_AGENT') || undefined,
        });
        resolvedPlace = resolution.resolvedPlace;
        placeResolution = resolution.summary;
        placeCandidates = resolution.candidates;
      } else if (placeAsCountry) {
        placeResolution = {
          status: 'resolved',
          query: requestedPlace,
          candidateCount: 1,
          selectionReason: 'offline-country-catalog',
        };
      } else if (hasCenterLat) {
        placeResolution = {
          status: 'resolved',
          query: requestedPlace || undefined,
          candidateCount: 1,
          selectionReason: 'explicit-coordinates',
        };
      }

      const research = researchMemoryContext(memory, {
        query,
        place: requestedPlace,
        region,
        dateFrom,
        dateTo,
        centerLat,
        centerLng,
        radiusKm,
        limit,
        resolvedPlace,
        placeResolution,
      }, timeZone);
      const starById = new Map(memory.stars.map(star => [star.id, star]));
      const starIndex = new Map(memory.stars.map((star, index) => [star.id, index]));
      const noteById = new Map(memory.notes.map(note => [note.id, note]));
      const trackById = new Map(memory.tracks.map(track => [track.id, track]));
      const residualQuery = research.searchPlan.residualTextQuery;
      const notes = research.selectedNoteIds.flatMap(noteId => {
        const note = noteById.get(noteId);
        const star = note ? starById.get(note.star_id) : null;
        if (!note || !star) return [];
        const siblings = groupedNotes.get(star.id) || [];
        return [noteSummary(
          note,
          star,
          starIndex.get(star.id) || 0,
          siblings.findIndex(item => item.id === note.id),
          residualQuery,
        )];
      });
      const titleIndex = research.titleNoteIds.flatMap(noteId => {
        const note = noteById.get(noteId);
        const star = note ? starById.get(note.star_id) : null;
        if (!note || !star) return [];
        const title = explicitMemoryNoteTitle(note);
        return [{
          id: note.id,
          starId: note.star_id,
          title: title || 'Untitled note',
          hasExplicitTitle: Boolean(title),
          createdAt: note.created_at_ms ?? star.created_at_ms,
          coordinates: { lat: star.lat, lng: star.lng },
          retrievalRole: 'title-index',
        }];
      });
      const candidateNotes = research.candidateNoteIds.flatMap(noteId => {
        const note = noteById.get(noteId);
        const star = note ? starById.get(note.star_id) : null;
        if (!note || !star) return [];
        const summary = noteSummary(
          note,
          star,
          starIndex.get(star.id) || 0,
          (groupedNotes.get(star.id) || []).findIndex(item => item.id === note.id),
        );
        return [{
          id: summary.id,
          starId: summary.starId,
          title: summary.title,
          text: summary.text,
          createdAt: summary.createdAt,
          coordinates: summary.coordinates,
          retrievalRole: 'candidate-only',
          evidenceStatus: 'unverified',
        }];
      });
      const locations = research.selectedStarIds.flatMap(starId => {
        const star = starById.get(starId);
        return star ? [starSummary(star, starIndex.get(star.id) || 0, groupedNotes.get(star.id) || [])] : [];
      });
      const routes = research.selectedTrackIds.flatMap(trackId => {
        const track = trackById.get(trackId);
        return track ? [routeSummary(track, false)] : [];
      });
      const returnedEntityCount = notes.length + locations.length + routes.length;
      return output({
        ...research,
        placeCandidates,
        notes,
        titleIndex,
        candidateNotes,
        locations,
        routes,
        records: notes,
        returnedEntityCount,
      }, returnedEntityCount, query || requestedPlace || region);
    }

    if (action === 'get_location_memory') {
      const starId = getString(body.starId);
      if (!starId) return fail('bad_request', 'starId is required.', 400);
      const star = memory.stars[0];
      if (!star) return fail('not_found', 'Location was not found.', 404);
      const starIndex = Math.max(0, Number(star.sort_order) || 0);
      const notes = (groupedNotes.get(star.id) || []).map((note, noteIndex) => noteSummary(note, star, starIndex, noteIndex));
      return output({ location: starSummary(star, starIndex, groupedNotes.get(star.id) || []), notes, records: notes }, notes.length);
    }

    if (action === 'get_day_memory') {
      const date = getString(body.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('bad_request', 'date must be YYYY-MM-DD.', 400);
      const starIndex = new Map(memory.stars.map((star, index) => [star.id, index]));
      const starById = new Map(memory.stars.map(star => [star.id, star]));
      const notes = memory.notes.flatMap(note => {
        const star = starById.get(note.star_id);
        if (!star || dateKeyFor(note.created_at_ms ?? star.created_at_ms, timeZone) !== date) return [];
        const siblings = groupedNotes.get(star.id) || [];
        return [noteSummary(note, star, starIndex.get(star.id) || 0, siblings.findIndex(item => item.id === note.id))];
      });
      const locations = memory.stars
        .map((star, index) => ({ star, index, notes: groupedNotes.get(star.id) || [] }))
        .filter(entry => dateKeyFor(entry.star.created_at_ms, timeZone) === date
          || entry.notes.some(note => dateKeyFor(note.created_at_ms ?? entry.star.created_at_ms, timeZone) === date))
        .map(entry => starSummary(entry.star, entry.index, entry.notes));
      return output({ date, locations, notes, records: notes }, notes.length);
    }

    if (action === 'get_routes') {
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      const routes = memory.tracks
        .filter(track => !dateFrom && !dateTo ? true : isInDateRange(track.created_at_ms, dateFrom, dateTo, timeZone))
        .map(track => routeSummary(track, getBoolean(body.includePaths)));
      return output({ routes, records: routes }, routes.length);
    }

    if (action === 'export_memory_report') {
      return output({ format: 'html', html: buildMemoryReportHtml(memory, timeZone) }, memory.stars.length);
    }

    if (action === 'create_star') {
      requireWriteIntent(body, corsHeaders);
      const lat = getNumber(body.lat, Number.NaN);
      const lng = getNumber(body.lng, Number.NaN);
      if (!isFiniteCoordinate(lat, lng)) return fail('bad_request', 'lat and lng must be valid coordinates.', 400);
      const now = Date.now();
      const starId = createId('star');
      const star: StarRow = {
        id: starId,
        sort_order: memory.stars.length,
        lat,
        lng,
        created_at_ms: now,
        tag_order: null,
        tag_group_id: null,
        color: getString(body.color) || null,
      };
      const mutations: MemoryMutationWire[] = [{ type: 'star_upsert', entityId: starId, payload: starPayload(star) }];
      if (body.note && typeof body.note === 'object') {
        const input = sanitizeValue(body.note) as Record<string, unknown>;
        const noteId = createId('note');
        mutations.push({
          type: 'note_upsert', entityId: noteId, starId,
          payload: {
            id: noteId, starId, sortOrder: 0,
            title: getString(input.title), titleHtml: sanitizeRichHtml(input.titleHtml),
            content: getString(input.content), contentHtml: sanitizeRichHtml(input.contentHtml),
            imageUrl: getString(input.imageUrl) || null,
            imageUrls: getArray(input.imageUrls), images: getArray(input.images),
            fontSize: input.fontSize ?? null, titleFontSize: input.titleFontSize ?? null,
            color: getString(input.color) || null, createdAt: now, updatedAt: now,
          },
        });
      }
      const result = await applyWrite({ supabaseUrl, anonKey, accessToken, revision: memory.revision, mutations });
      return jsonResponse({ ok: true, revision: result.revision, location: starSummary(star, star.sort_order, []), star }, 200, corsHeaders);
    }

    if (action === 'update_star') {
      requireWriteIntent(body, corsHeaders);
      const starId = getString(body.starId);
      const star = memory.stars.find(item => item.id === starId);
      if (!star) return fail('not_found', 'Location was not found.', 404);
      const input = sanitizeValue(body.updates || {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {};
      Object.entries(input).forEach(([key, value]) => {
        if (writableStarKeys.has(key)) updates[key] = value;
      });
      const payload = starPayload(star, updates);
      if (!isFiniteCoordinate(payload.lat, payload.lng)) return fail('bad_request', 'lat and lng must be valid coordinates.', 400);
      const result = await applyWrite({
        supabaseUrl, anonKey, accessToken, revision: memory.revision,
        mutations: [{ type: 'star_upsert', entityId: starId, payload }],
      });
      return jsonResponse({ ok: true, revision: result.revision }, 200, corsHeaders);
    }

    if (action === 'add_note_to_star') {
      requireWriteIntent(body, corsHeaders);
      const starId = getString(body.starId);
      const star = memory.stars.find(item => item.id === starId);
      if (!star) return fail('not_found', 'Location was not found.', 404);
      const input = sanitizeValue(body.note || {}) as Record<string, unknown>;
      const now = Date.now();
      const noteId = createId('note');
      const payload = {
        id: noteId, starId, sortOrder: (groupedNotes.get(starId) || []).length,
        title: getString(input.title), titleHtml: sanitizeRichHtml(input.titleHtml),
        content: getString(input.content), contentHtml: sanitizeRichHtml(input.contentHtml),
        imageUrl: getString(input.imageUrl) || null,
        imageUrls: getArray(input.imageUrls), images: getArray(input.images),
        fontSize: input.fontSize ?? null, titleFontSize: input.titleFontSize ?? null,
        color: getString(input.color) || null, createdAt: now, updatedAt: now,
      };
      const result = await applyWrite({
        supabaseUrl, anonKey, accessToken, revision: memory.revision,
        mutations: [{ type: 'note_upsert', entityId: noteId, starId, payload }],
      });
      return jsonResponse({ ok: true, revision: result.revision, noteId }, 200, corsHeaders);
    }

    if (action === 'update_note') {
      requireWriteIntent(body, corsHeaders);
      const starId = getString(body.starId);
      const noteId = getString(body.noteId);
      const note = memory.notes.find(item => item.star_id === starId && item.id === noteId);
      if (!note) return fail('not_found', 'Note was not found.', 404);
      const input = sanitizeValue(body.updates || {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = { updatedAt: Date.now() };
      Object.entries(input).forEach(([key, value]) => {
        if (!writableNoteKeys.has(key)) return;
        updates[key] = key === 'contentHtml' || key === 'titleHtml' ? sanitizeRichHtml(value) : value;
      });
      const result = await applyWrite({
        supabaseUrl, anonKey, accessToken, revision: memory.revision,
        mutations: [{ type: 'note_upsert', entityId: noteId, starId, payload: notePayload(note, updates) }],
      });
      return jsonResponse({ ok: true, revision: result.revision, noteId }, 200, corsHeaders);
    }

    if (action === 'delete_note') {
      requireDeleteIntent(body, corsHeaders);
      const starId = getString(body.starId);
      const noteId = getString(body.noteId);
      if (!memory.notes.some(note => note.star_id === starId && note.id === noteId)) return fail('not_found', 'Note was not found.', 404);
      const result = await applyWrite({
        supabaseUrl, anonKey, accessToken, revision: memory.revision,
        mutations: [{ type: 'note_soft_delete', entityId: noteId, starId }],
      });
      return jsonResponse({ ok: true, revision: result.revision, deletedNoteId: noteId, mediaDeletion: 'deferred' }, 200, corsHeaders);
    }

    if (action === 'delete_star') {
      requireDeleteIntent(body, corsHeaders);
      const starId = getString(body.starId);
      const star = memory.stars.find(item => item.id === starId);
      if (!star) return fail('not_found', 'Location was not found.', 404);
      const mutations: MemoryMutationWire[] = memory.stars
        .filter(item => star.tag_order !== null && star.tag_group_id !== null
          && item.tag_group_id === star.tag_group_id && item.tag_order !== null && item.tag_order > star.tag_order)
        .map(item => ({
          type: 'star_upsert', entityId: item.id,
          payload: starPayload(item, { tagOrder: Math.max(0, Number(item.tag_order) - 1) }),
        }));
      mutations.push({ type: 'star_soft_delete', entityId: starId });
      const result = await applyWrite({ supabaseUrl, anonKey, accessToken, revision: memory.revision, mutations });
      return jsonResponse({ ok: true, revision: result.revision, deletedStarId: starId, mediaDeletion: 'deferred' }, 200, corsHeaders);
    }

    if (action === 'delete_route') {
      requireDeleteIntent(body, corsHeaders);
      const routeId = getString(body.routeId);
      if (!memory.tracks.some(track => track.id === routeId)) return fail('not_found', 'Route was not found.', 404);
      const result = await applyWrite({
        supabaseUrl, anonKey, accessToken, revision: memory.revision,
        mutations: [{ type: 'track_soft_delete', entityId: routeId }],
      });
      return jsonResponse({ ok: true, revision: result.revision, deletedRouteId: routeId }, 200, corsHeaders);
    }

    return fail('unknown_action', 'Unknown memory API action.', 400);
  } catch (error) {
    if (error instanceof Response) return error;
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
    const code = error && typeof error === 'object' && 'code' in error ? getString(error.code, 'internal_error') : 'internal_error';
    return fail(code, error instanceof Error ? error.message : 'Unexpected memory API error.', status || 500);
  }
});
