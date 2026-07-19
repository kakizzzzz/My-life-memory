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
  noteTitle,
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
  isPersonalMemoryReference,
} from '../_shared/memory-personal-context.ts';
import {
  inferMemoryPlaceHint,
  isSafePublicPlaceCandidate,
} from '../_shared/mcp-query-routing.mjs';
import { collectMemoryImageReferences } from '../_shared/memory-image-references.ts';
import {
  projectPublicMemoryResearchResponse,
  type MemoryReferenceClarification,
} from '../_shared/memory-public-response.ts';
import {
  buildMemoryReferenceOptions,
  buildMemoryReferenceQuestion,
  buildMemoryReferenceRefinementQuestion,
  type MemorySemanticHints,
} from '../_shared/memory-reference-candidates.ts';
import {
  createMemoryReferenceToken,
  verifyMemoryReferenceToken,
} from '../_shared/memory-reference-token.ts';
import {
  buildMemoryTemporalContext,
  normalizeTimeZone,
  validTimeZoneOrNull,
} from '../_shared/time-zone.ts';

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

type ReferenceConfirmationInput = {
  continuationToken: string;
  selectedOptionId?: string;
  answer: 'confirm' | 'reject' | 'none';
};

const referenceConfirmationInput = (value: unknown): {
  value?: ReferenceConfirmationInput;
  error?: string;
} => {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'referenceConfirmation must be an object.' };
  }
  const record = value as Record<string, unknown>;
  const continuationToken = getString(record.continuationToken).trim();
  const selectedOptionId = getString(record.selectedOptionId).trim();
  const answer = getString(record.answer);
  if (!continuationToken || continuationToken.length > 16_384) {
    return { error: 'referenceConfirmation.continuationToken is invalid.' };
  }
  if (selectedOptionId.length > 80) {
    return { error: 'referenceConfirmation.selectedOptionId is invalid.' };
  }
  if (!['confirm', 'reject', 'none'].includes(answer)) {
    return { error: 'referenceConfirmation.answer must be confirm, reject, or none.' };
  }
  return {
    value: {
      continuationToken,
      ...(selectedOptionId ? { selectedOptionId } : {}),
      answer: answer as ReferenceConfirmationInput['answer'],
    },
  };
};

const semanticHintsInput = (value: unknown): {
  value?: MemorySemanticHints;
  error?: string;
} => {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'semanticHints must be an object.' };
  }
  const concepts = (value as Record<string, unknown>).concepts;
  if (!Array.isArray(concepts) || concepts.length > 6) {
    return { error: 'semanticHints.concepts must contain at most 6 items.' };
  }
  const parsed = concepts.map(concept => {
    if (!concept || typeof concept !== 'object' || Array.isArray(concept)) return null;
    const record = concept as Record<string, unknown>;
    const surface = getString(record.surface).trim();
    const broadTerms = record.broadTerms;
    if (!surface || surface.length > 48 || !Array.isArray(broadTerms) || broadTerms.length > 8) return null;
    const terms = broadTerms.map(term => getString(term).trim());
    if (terms.some(term => !term || term.length > 48)) return null;
    return { surface, broadTerms: [...new Set(terms)] };
  });
  if (parsed.some(concept => !concept)) {
    return { error: 'Each semanticHints concept requires a surface and bounded broadTerms.' };
  }
  return { value: { concepts: parsed as NonNullable<typeof parsed[number]>[] } };
};

const noteHasStoredImages = (note: NoteRow) => Boolean(
  note.image_url
  || note.image_urls?.length
  || note.images?.length
  || /data-media-(?:path|key)=/i.test(`${note.title_html} ${note.content_html}`)
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

    let timeZone = validTimeZoneOrNull(body.timeZone);
    if (!timeZone) {
      const { data: settings, error: settingsError } = await admin
        .from('memory_settings')
        .select('profile_metadata')
        .eq('user_id', userId)
        .maybeSingle();
      if (settingsError) throw settingsError;
      const profileMetadata = settings?.profile_metadata && typeof settings.profile_metadata === 'object'
        ? settings.profile_metadata as Record<string, unknown>
        : {};
      timeZone = normalizeTimeZone(profileMetadata.timeZone);
    }
    const temporalContext = buildMemoryTemporalContext(timeZone);
    if (action === 'get_temporal_context') {
      return memoryResponse(action, { temporalContext }, corsHeaders, 1);
    }
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
        { temporalContext, ...summary },
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
      memoryResponse(action, { temporalContext, ...payload }, corsHeaders, count, query)
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
      const requestQuery = getString(body.query).trim();
      let query = requestQuery;
      const place = getString(body.place).trim();
      const region = getString(body.region).trim();
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      if (!requestQuery && !place && !region) {
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
      const semanticHints = semanticHintsInput(body.semanticHints);
      if (semanticHints.error) return fail('bad_request', semanticHints.error, 400);
      const referenceConfirmation = referenceConfirmationInput(body.referenceConfirmation);
      if (referenceConfirmation.error) return fail('bad_request', referenceConfirmation.error, 400);
      const confirmationSecret = Deno.env.get('MEMORY_REFERENCE_CONFIRMATION_SECRET')
        || internalToken
        || serviceRoleKey;
      const confirmation = referenceConfirmation.value;
      const verifiedConfirmation = confirmation
        ? await verifyMemoryReferenceToken({
          secret: confirmationSecret,
          token: confirmation.continuationToken,
          userId,
          query: requestQuery,
          revision: memory.revision,
        })
        : null;
      if (verifiedConfirmation?.valid && verifiedConfirmation.originalQuery) {
        query = verifiedConfirmation.originalQuery;
      }
      const inferredQueryPlace = !place && !region ? inferMemoryPlaceHint(query) : '';
      const requestedPlace = place || (
        region && !resolveExactMemoryCountryRegion(region) ? region : inferredQueryPlace
      );
      if (requestedPlace.length > 160) return fail('bad_request', 'place must be 160 characters or fewer.', 400);
      const placeSource = body.placeSource === 'query-span' || inferredQueryPlace
        ? 'query-span'
        : 'explicit-argument';
      const privatePlaceReference = isPersonalMemoryReference(requestedPlace);
      const publicPlaceCandidate = isSafePublicPlaceCandidate(requestedPlace);
      const geocodablePlace = !privatePlaceReference && publicPlaceCandidate ? requestedPlace : '';

      let resolvedPlace: ResolvedMemoryPlace | null = null;
      let placeResolution: MemoryPlaceResolutionSummary = requestedPlace && !geocodablePlace ? {
        status: 'not-requested',
        query: requestedPlace,
        message: privatePlaceReference
          ? 'Private personal-place references are resolved only from the authenticated user memory archive.'
          : 'The value was not an explicit public geographic place and was not sent to the public geocoder.',
      } : { status: 'not-requested' };
      const placeAsCountry = resolveExactMemoryCountryRegion(geocodablePlace);
      if (geocodablePlace && !placeAsCountry && !hasCenterLat) {
        const country = resolveMemoryCountryRegion(region)
          || resolveMemoryCountryRegion(geocodablePlace);
        const resolution = await resolveMemoryPlace({
          place: geocodablePlace,
          countryCode: country?.region.code,
          memoryCoordinates: memory.stars.map(star => ({ lat: star.lat, lng: star.lng })),
          endpoint: Deno.env.get('MEMORY_GEOCODER_URL') || undefined,
          userAgent: Deno.env.get('MEMORY_GEOCODER_USER_AGENT') || undefined,
        });
        resolvedPlace = resolution.resolvedPlace;
        placeResolution = resolution.summary;
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

      let confirmedReference: {
        noteId: string;
        starId: string;
        relation: 'home' | 'work' | 'study' | 'observation' | 'activity';
        label: string;
      } | null = null;
      let referenceClarification: MemoryReferenceClarification | null = null;
      if (confirmation) {
        const verified = verifiedConfirmation;
        if (!verified?.valid || confirmation.answer !== 'confirm') {
          const exactText = buildMemoryReferenceRefinementQuestion(query);
          referenceClarification = {
            exactText,
            kind: 'request-facet',
            options: [],
            continuationToken: null,
            requestedFacets: ['time', 'place', 'title-word', 'object-name', 'activity'],
          };
        } else {
          const selected = confirmation.selectedOptionId
            ? verified.options.find(option => option.optionId === confirmation.selectedOptionId)
            : verified.options.length === 1 ? verified.options[0] : null;
          if (!selected) {
            const options = verified.options.map(option => ({ optionId: option.optionId, label: option.label }));
            const exactText = buildMemoryReferenceQuestion(query, options.map(option => option.label));
            referenceClarification = {
              exactText,
              kind: options.length === 1 ? 'yes-no' : 'choose-option',
              options,
              continuationToken: confirmation.continuationToken,
              requestedFacets: ['time', 'place', 'title-word', 'object-name', 'activity'],
            };
          } else {
            confirmedReference = {
              noteId: selected.noteId,
              starId: selected.starId,
              relation: selected.relation,
              label: selected.label,
            };
          }
        }
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
        placeSource,
        resolvedPlace,
        placeResolution,
        confirmedReference,
      }, timeZone);

      if (!referenceClarification
        && research.answerBoundary.status === 'not-found'
        && (research.personalContext.requested
          || research.queryPlan.referenceIntent.deictic
          || research.queryPlan.utteranceMode !== 'direct-question')) {
        const internalOptions = buildMemoryReferenceOptions({
          memory,
          queryPlan: research.queryPlan,
          semanticHints: semanticHints.value,
          allowedNoteIds: research.candidateScopeNoteIds,
        });
        if (internalOptions.length) {
          const issued = await createMemoryReferenceToken({
            secret: confirmationSecret,
            userId,
            query,
            revision: memory.revision,
            options: internalOptions,
          });
          const exactText = buildMemoryReferenceQuestion(
            query,
            issued.options.map(option => option.label),
          );
          referenceClarification = {
            exactText,
            kind: issued.options.length === 1 ? 'yes-no' : 'choose-option',
            options: issued.options,
            continuationToken: issued.token,
            requestedFacets: ['time', 'place', 'title-word', 'object-name', 'activity'],
          };
        }
      }

      const starById = new Map(memory.stars.map(star => [star.id, star]));
      const starIndex = new Map(memory.stars.map((star, index) => [star.id, index]));
      const noteById = new Map(memory.notes.map(note => [note.id, note]));
      const trackById = new Map(memory.tracks.map(track => [track.id, track]));
      const evidenceNoteIds = new Set(research.evidencePassages.map(passage => passage.noteId));
      const records = research.selectedNoteIds.flatMap(noteId => {
        if (!evidenceNoteIds.has(noteId)) return [];
        const note = noteById.get(noteId);
        const star = note ? starById.get(note.star_id) : null;
        if (!note || !star) return [];
        const excerpt = research.evidencePassages
          .filter(passage => passage.noteId === note.id)
          .map(passage => passage.text.trim())
          .filter(Boolean)
          .join(' ')
          .slice(0, 240);
        return [{
          id: note.id,
          starId: star.id,
          title: noteTitle(note),
          excerpt,
          createdAt: note.created_at_ms ?? star.created_at_ms,
          hasImages: noteHasStoredImages(note),
          coordinates: { lat: star.lat, lng: star.lng },
        }];
      });
      const evidenceStarIds = new Set([
        ...records.map(record => record.starId),
        ...research.evidencePassages.map(passage => passage.starId),
      ]);
      const locations = [...evidenceStarIds].flatMap(starId => {
        const star = starById.get(starId);
        return star ? [{
          id: star.id,
          index: starIndex.get(star.id) || 0,
          coordinates: { lat: star.lat, lng: star.lng },
          noteCount: (groupedNotes.get(star.id) || []).length,
        }] : [];
      });
      const routes = research.queryPlan.routeIntent ? research.selectedTrackIds.flatMap(trackId => {
        const track = trackById.get(trackId);
        if (!track) return [];
        const summary = routeSummary(track, false);
        return [{
          id: summary.id,
          durationSeconds: summary.durationSeconds,
          distance: summary.distance,
          createdAt: summary.createdAt,
          segmentCount: summary.segmentCount,
          pointCount: summary.pointCount,
        }];
      }) : [];
      const publicResearch = projectPublicMemoryResearchResponse({
        research,
        records,
        locations,
        routes,
        referenceClarification,
      });
      return jsonResponse({
        ok: true,
        source: 'my-life-memory-normalized-v2',
        action,
        query,
        timestamp: new Date().toISOString(),
        temporalContext,
        ...publicResearch,
      }, 200, corsHeaders);
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
