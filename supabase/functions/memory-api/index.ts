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

type AdminClient = ReturnType<typeof createClient<any>>;
type ProfileRow = { account_id: string | null; name: string | null; avatar_url: string | null };
type StateRow = { state: Record<string, unknown> | null };

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://kakizzzzz.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const sensitiveStateKeys = new Set([
  'password',
  'loginpassword',
  'registerpassword',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'invitecode',
]);

const writableNoteKeys = new Set([
  'content',
  'contentHtml',
  'imageUrl',
  'imageUrls',
  'images',
  'fontSize',
  'titleFontSize',
  'color',
]);

const writeActions = new Set([
  'create_star',
  'update_star',
  'add_note_to_star',
  'update_note',
  'delete_note',
  'delete_star',
  'delete_route',
]);

const writableStarKeys = new Set([
  'lat',
  'lng',
  'color',
  'tagOrder',
  'tagGroupId',
]);

const jsonResponse = (
  body: unknown,
  status = 200,
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => (
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
);

const errorResponse = (
  code: string,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => (
  jsonResponse({ error: { code, message, ...extra } }, status, corsHeaders)
);

const memoryResponse = (
  action: string,
  body: Record<string, unknown>,
  meta: { count?: number; query?: string } = {},
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => {
  const count = Number.isFinite(meta.count) ? meta.count as number : getNumber(body.count, 0);
  return jsonResponse({
    ok: true,
    source: 'my-life-memory',
    action,
    query: meta.query ?? getString(body.query),
    timestamp: new Date().toISOString(),
    ...(count === 0 ? {
      records: [],
      instruction: 'No matching records. Do not infer or invent.',
    } : {}),
    ...body,
    count,
  }, 200, corsHeaders);
};

const sanitizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item));
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (sensitiveStateKeys.has(key.toLowerCase())) return;
    sanitized[key] = sanitizeValue(entry);
  });
  return sanitizeHtmlFields(sanitized);
};

const getString = (value: unknown, fallback = '') => (
  typeof value === 'string' ? value : fallback
);

const getNumber = (value: unknown, fallback = 0) => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const getBoolean = (value: unknown) => value === true || value === 'true';

const getArray = (value: unknown) => (Array.isArray(value) ? value : []);

const isFiniteCoordinate = (lat: unknown, lng: unknown) => {
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

const stripHtml = (html?: string) => (
  getString(html)
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
    .trim()
);

const noteText = (note: Record<string, unknown>) => {
  const content = getString(note.content).trim();
  const htmlText = stripHtml(getString(note.contentHtml));
  return content || htmlText;
};

const noteTitle = (note: Record<string, unknown>) => {
  const text = noteText(note);
  return text.length > 40 ? `${text.slice(0, 40)}...` : text || 'Untitled note';
};

const createId = (prefix: string) => {
  const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
};

const escapeHtml = (value: unknown) => (
  getString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
);

const dateKeyFor = (timestamp: unknown, timeZone = 'Asia/Shanghai') => {
  const number = typeof timestamp === 'number' ? timestamp : Number(timestamp);
  if (!Number.isFinite(number)) return '';
  const date = new Date(number);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value || '';
  const month = parts.find(part => part.type === 'month')?.value || '';
  const day = parts.find(part => part.type === 'day')?.value || '';
  return year && month && day ? `${year}-${month}-${day}` : '';
};

const isInDateRange = (timestamp: unknown, dateFrom?: string, dateTo?: string, timeZone?: string) => {
  const key = dateKeyFor(timestamp, timeZone);
  if (!key) return false;
  if (dateFrom && key < dateFrom) return false;
  if (dateTo && key > dateTo) return false;
  return true;
};

const getStars = (state: Record<string, unknown>) => (
  getArray(state.stars).filter(star => star && typeof star === 'object') as Array<Record<string, unknown>>
);

const getTracks = (state: Record<string, unknown>) => (
  getArray(state.savedTracks).filter(track => track && typeof track === 'object') as Array<Record<string, unknown>>
);

const getNotes = (star: Record<string, unknown>) => (
  getArray(star.notes).filter(note => note && typeof note === 'object') as Array<Record<string, unknown>>
);

const cleanImageMetadata = (image: Record<string, unknown>) => ({
  provider: getString(image.provider),
  bucket: getString(image.bucket),
  key: getString(image.key),
  path: getString(image.path),
  mimeType: getString(image.mimeType),
  size: getNumber(image.size, 0),
  createdAt: getString(image.createdAt),
});

const noteImages = (note: Record<string, unknown>) => (
  getArray(note.images)
    .filter(image => image && typeof image === 'object')
    .map(image => cleanImageMetadata(image as Record<string, unknown>))
    .filter(image => image.path || image.key)
);

const starSummary = (star: Record<string, unknown>, index: number) => {
  const notes = getNotes(star);
  return {
    id: getString(star.id),
    index,
    lat: getNumber(star.lat),
    lng: getNumber(star.lng),
    color: getString(star.color),
    createdAt: getNumber(star.createdAt, 0) || null,
    noteCount: notes.length,
    meaningfulNoteCount: notes.filter(note => noteText(note).length > 0 || noteImages(note).length > 0).length,
    tagOrder: star.tagOrder ?? null,
    tagGroupId: star.tagGroupId ?? null,
  };
};

const noteSummary = (note: Record<string, unknown>, star: Record<string, unknown>, starIndex: number, noteIndex: number, query = '') => {
  const text = noteText(note);
  const lowerText = text.toLowerCase();
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
    id: getString(note.id),
    starId: getString(star.id),
    starIndex,
    noteIndex,
    title: noteTitle(note),
    text,
    snippet: text.length > 180 ? `${text.slice(0, 180)}...` : text,
    createdAt: getNumber(note.createdAt, getNumber(star.createdAt, 0)) || null,
    updatedAt: getNumber(note.updatedAt, 0) || null,
    color: getString(note.color),
    images: noteImages(note),
    matchCount,
    coordinates: {
      lat: getNumber(star.lat),
      lng: getNumber(star.lng),
    },
  };
};

const collectMediaPathsFromNote = (note: Record<string, unknown>, userId: string) => {
  const paths = new Set<string>();
  noteImages(note).forEach(image => {
    const path = image.path || image.key;
    if (path && path.startsWith(`${userId}/`)) paths.add(path);
  });

  const contentHtml = getString(note.contentHtml);
  const attrPattern = /data-(?:media|storage)-(?:path|key)=["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(contentHtml)) !== null) {
    const path = match[1];
    if (path && path.startsWith(`${userId}/`)) paths.add(path);
  }

  return Array.from(paths);
};

const deleteMediaPaths = async (admin: AdminClient, paths: string[]) => {
  const uniquePaths = Array.from(new Set(paths)).filter(Boolean);
  if (uniquePaths.length === 0) return { deleted: [], error: null };
  const { error } = await admin.storage.from('life-media').remove(uniquePaths);
  return {
    deleted: error ? [] : uniquePaths,
    error: error ? error.message : null,
  };
};

const buildMemoryReportHtml = ({
  account,
  profile,
  stars,
  timeZone,
}: {
  account: string;
  profile: Record<string, unknown> | null;
  stars: Array<Record<string, unknown>>;
  timeZone: string;
}) => {
  const noteCount = stars.reduce((sum, star) => sum + getNotes(star).length, 0);
  const locations = stars.map((star, starIndex) => {
    const notes = getNotes(star).map((note, noteIndex) => {
      const noteData = noteSummary(note, star, starIndex, noteIndex);
      return (
        '<article class="note">' +
          `<h3>${escapeHtml(noteData.title)}</h3>` +
          `<p class="meta">Time: ${escapeHtml(dateKeyFor(noteData.createdAt, timeZone))}</p>` +
          (noteData.text ? `<p class="text">${escapeHtml(noteData.text)}</p>` : '<p class="empty">No text</p>') +
          (noteData.images.length ? `<p class="meta">${noteData.images.length} image(s)</p>` : '') +
        '</article>'
      );
    }).join('');

    return (
      '<section class="location">' +
        `<h2>Location ${starIndex + 1}</h2>` +
        `<p class="meta">Coordinates: ${getNumber(star.lat).toFixed(6)}, ${getNumber(star.lng).toFixed(6)}</p>` +
        (notes || '<p class="empty">No notes</p>') +
      '</section>'
    );
  }).join('');

  return (
    '<!doctype html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>My Life Memory Export</title>' +
    '<style>body{margin:0;background:#f4f4f4;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}.page{max-width:880px;margin:0 auto;padding:40px 22px 64px}.location{background:#fff;border-radius:18px;padding:18px;margin:18px 0}.note{border-top:1px solid #eee;padding:12px 0}.note:first-of-type{border-top:0}.meta{color:#666;font-size:13px}.text{white-space:pre-wrap}.empty{color:#999}</style>' +
    '</head><body><main class="page">' +
      '<header>' +
        '<h1>My Life Memory</h1>' +
        `<p class="meta">Account: ${escapeHtml(account)}</p>` +
        (profile?.name ? `<p class="meta">Name: ${escapeHtml(profile.name)}</p>` : '') +
        `<p class="meta">${stars.length} locations, ${noteCount} notes</p>` +
      '</header>' +
      (locations || '<section class="location"><p class="empty">No memories yet.</p></section>') +
    '</main></body></html>'
  );
};

const loadMemoryForUserId = async (
  admin: AdminClient,
  userId: string,
  accountFallback = '',
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => {
  const [{ data: profileRow, error: profileError }, { data: stateRow, error: stateError }] = await Promise.all([
    admin
      .from('profiles')
      .select('account_id,name,avatar_url')
      .eq('id', userId)
      .maybeSingle<ProfileRow>(),
    admin
      .from('app_states')
      .select('state')
      .eq('user_id', userId)
      .maybeSingle<StateRow>(),
  ]);

  if (profileError || stateError) {
    throw new Response(JSON.stringify({
      error: {
        code: 'setup_required',
        message: profileError?.message || stateError?.message || 'Could not load memory state.',
      },
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const state = sanitizeValue(stateRow?.state || {}) as Record<string, unknown>;
  return {
    userId,
    account: getString(profileRow?.account_id, accountFallback),
    profile: profileRow,
    state,
  };
};

const loadMemory = async (
  admin: AdminClient,
  token: string,
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => {
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    throw new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'A valid user token is required.' } }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return loadMemoryForUserId(admin, userData.user.id, '', corsHeaders);
};

const saveState = async (admin: AdminClient, userId: string, state: Record<string, unknown>) => {
  const { error } = await admin
    .from('app_states')
    .upsert({ user_id: userId, state: sanitizeValue(state) }, { onConflict: 'user_id' });
  if (error) throw error;
};

const requireWriteIntent = (
  body: Record<string, unknown>,
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => {
  if (!getBoolean(body.confirmWrite)) {
    throw new Response(JSON.stringify({
      error: {
        code: 'write_confirmation_required',
        message: 'Set confirmWrite to true before changing memories.',
      },
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

const requireDeleteIntent = (
  body: Record<string, unknown>,
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
) => {
  requireWriteIntent(body, corsHeaders);
  if (body.confirm !== 'DELETE') {
    throw new Response(JSON.stringify({
      error: {
        code: 'delete_confirmation_required',
        message: 'Set confirm to DELETE before deleting memories.',
      },
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(async request => {
  if (!isOriginAllowed(request)) {
    return forbiddenOriginResponse();
  }

  const localCorsHeaders = createCorsHeaders(request);
  const json = (body: unknown, status = 200) => jsonResponse(body, status, localCorsHeaders);
  const fail = (
    code: string,
    message: string,
    status = 400,
    extra: Record<string, unknown> = {},
  ) => errorResponse(code, message, status, extra, localCorsHeaders);
  const memoryOut = (
    action: string,
    body: Record<string, unknown>,
    meta: { count?: number; query?: string } = {},
  ) => memoryResponse(action, body, meta, localCorsHeaders);
  const requireWrite = (input: Record<string, unknown>) => requireWriteIntent(input, localCorsHeaders);
  const requireDelete = (input: Record<string, unknown>) => requireDeleteIntent(input, localCorsHeaders);

  const ipLimit = await hitRateLimit(`memory-api:${clientIp(request)}`, 180, 60_000);
  if (ipLimit.limited) {
    return rateLimitResponse(localCorsHeaders, ipLimit.retryAfterSeconds);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: localCorsHeaders });
  }

  if (request.method !== 'POST') {
    return fail('method_not_allowed', 'Method not allowed.', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const internalToken = Deno.env.get('MEMORY_API_INTERNAL_TOKEN') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return fail('setup_required', 'Memory API is not configured.', 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail('bad_request', 'Invalid request body.', 400);
  }

  const admin = createClient<any>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const internalHeader = request.headers.get('x-memory-api-internal-token') || '';
    const authLimit = await hitRateLimit(`memory-api-auth:${clientIp(request)}:${tokenPrefix(internalHeader || token)}`, 120, 60_000);
    if (authLimit.limited) {
      return rateLimitResponse(localCorsHeaders, authLimit.retryAfterSeconds);
    }
    let memory: Awaited<ReturnType<typeof loadMemoryForUserId>>;
    if (internalHeader) {
      if (!internalToken || internalHeader !== internalToken) {
        return fail('unauthorized', 'Invalid internal Memory API token.', 401);
      }
      const internalUserId = getString(body.userId);
      if (!internalUserId) {
        return fail('bad_request', 'Internal Memory API requests require userId.', 400);
      }
      memory = await loadMemoryForUserId(admin, internalUserId, '', localCorsHeaders);
    } else {
      memory = await loadMemory(admin, token, localCorsHeaders);
    }
    const action = getString(body.action);
    if (writeActions.has(action) && (Deno.env.get('ENABLE_MEMORY_API_WRITES') || '').toLowerCase() !== 'true') {
      return fail('writes_disabled', 'Memory API write actions are disabled in production.', 403);
    }

    const timeZone = getString(body.timeZone, 'Asia/Shanghai');
    const stars = getStars(memory.state);
    const tracks = getTracks(memory.state);

    if (action === 'list_locations') {
      const locations = stars.map(starSummary);
      return memoryOut(action, {
        locations,
        records: locations,
      }, { count: locations.length });
    }

    if (action === 'search_memories') {
      const query = getString(body.query).trim();
      const lowerQuery = query.toLowerCase();
      const limit = Math.min(Math.max(getNumber(body.limit, 20), 1), 100);
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      const results = stars.flatMap((star, starIndex) => (
        getNotes(star).map((note, noteIndex) => noteSummary(note, star, starIndex, noteIndex, query))
      )).filter(note => {
        if (dateFrom || dateTo) {
          const timestamp = note.createdAt || stars[note.starIndex]?.createdAt;
          if (!isInDateRange(timestamp, dateFrom, dateTo, timeZone)) return false;
        }
        if (!lowerQuery) return true;
        const coordinateText = `${note.coordinates.lat},${note.coordinates.lng}`;
        return (
          note.text.toLowerCase().includes(lowerQuery) ||
          note.title.toLowerCase().includes(lowerQuery) ||
          note.starId.toLowerCase().includes(lowerQuery) ||
          coordinateText.includes(lowerQuery)
        );
      }).slice(0, limit);

      return memoryOut(action, {
        query,
        results,
        records: results,
      }, { count: results.length, query });
    }

    if (action === 'get_location_memory') {
      const starId = getString(body.starId);
      const starIndex = stars.findIndex(star => getString(star.id) === starId);
      if (starIndex === -1) return fail('not_found', 'Location was not found.', 404);
      const star = stars[starIndex];
      const notes = getNotes(star).map((note, noteIndex) => noteSummary(note, star, starIndex, noteIndex));
      return memoryOut(action, {
        location: starSummary(star, starIndex),
        notes,
        records: notes,
      }, { count: notes.length });
    }

    if (action === 'get_day_memory') {
      const date = getString(body.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('bad_request', 'date must be YYYY-MM-DD.', 400);
      const notes = stars.flatMap((star, starIndex) => (
        getNotes(star)
          .map((note, noteIndex) => noteSummary(note, star, starIndex, noteIndex))
          .filter(note => dateKeyFor(note.createdAt || star.createdAt, timeZone) === date)
      ));
      const locations = stars
        .map((star, starIndex) => ({ star, starIndex }))
        .filter(({ star }) => (
          dateKeyFor(star.createdAt, timeZone) === date ||
          getNotes(star).some(note => dateKeyFor(note.createdAt || star.createdAt, timeZone) === date)
        ))
        .map(({ star, starIndex }) => starSummary(star, starIndex));
      return memoryOut(action, {
        date,
        locations,
        notes,
        records: notes,
      }, { count: notes.length });
    }

    if (action === 'get_routes') {
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      const routes = tracks.filter(track => {
        if (!dateFrom && !dateTo) return true;
        return isInDateRange(track.time, dateFrom, dateTo, timeZone);
      }).map(track => ({
        id: getString(track.id),
        color: getString(track.color),
        time: getNumber(track.time, 0) || null,
        distance: getNumber(track.distance, 0),
        segmentCount: getArray(track.paths).length,
        pointCount: getArray(track.paths).reduce((sum, segment) => sum + getArray(segment).length, 0),
        paths: getBoolean(body.includePaths) ? track.paths : undefined,
      }));
      return memoryOut(action, {
        routes,
        records: routes,
      }, { count: routes.length });
    }

    if (action === 'summarize_memory_range') {
      const dateFrom = getString(body.dateFrom);
      const dateTo = getString(body.dateTo);
      const notes = stars.flatMap((star, starIndex) => (
        getNotes(star)
          .map((note, noteIndex) => noteSummary(note, star, starIndex, noteIndex))
          .filter(note => !dateFrom && !dateTo ? true : isInDateRange(note.createdAt, dateFrom, dateTo, timeZone))
      ));
      const routes = tracks.filter(track => !dateFrom && !dateTo ? true : isInDateRange(track.time, dateFrom, dateTo, timeZone));
      const topLocations = stars
        .map((star, starIndex) => ({
          ...starSummary(star, starIndex),
          matchedNotes: notes.filter(note => note.starId === getString(star.id)).length,
        }))
        .filter(location => location.matchedNotes > 0)
        .sort((a, b) => b.matchedNotes - a.matchedNotes)
        .slice(0, 10);
      return memoryOut(action, {
        range: { dateFrom: dateFrom || null, dateTo: dateTo || null, timeZone },
        totals: {
          locations: new Set(notes.map(note => note.starId)).size,
          notes: notes.length,
          images: notes.reduce((sum, note) => sum + note.images.length, 0),
          routes: routes.length,
          routeDistanceKm: routes.reduce((sum, route) => sum + getNumber(route.distance, 0), 0),
        },
        topLocations,
        records: topLocations,
      }, { count: notes.length });
    }

    if (action === 'export_memory_report') {
      return memoryOut(action, {
        format: 'html',
        html: buildMemoryReportHtml({
          account: memory.account,
          profile: memory.profile,
          stars,
          timeZone,
        }),
      }, { count: stars.length });
    }

    if (action === 'create_star') {
      requireWrite(body);
      const lat = getNumber(body.lat, Number.NaN);
      const lng = getNumber(body.lng, Number.NaN);
      if (!isFiniteCoordinate(lat, lng)) return fail('bad_request', 'lat and lng must be valid coordinates.', 400);
      const star: Record<string, unknown> = {
        id: createId('star'),
        lat,
        lng,
        createdAt: Date.now(),
      };
      if (typeof body.color === 'string') star.color = body.color;

      if (body.note && typeof body.note === 'object') {
        const noteInput = sanitizeValue(body.note) as Record<string, unknown>;
        star.notes = [{
          id: createId('note'),
          content: getString(noteInput.content),
          contentHtml: sanitizeRichHtml(noteInput.contentHtml),
          images: getArray(noteInput.images),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }];
      }

      const nextStars = [...stars, star];
      await saveState(admin, memory.userId, { ...memory.state, stars: nextStars });
      return json({ ok: true, location: starSummary(star, nextStars.length - 1), star });
    }

    if (action === 'update_star') {
      requireWrite(body);
      const starId = getString(body.starId);
      const starIndex = stars.findIndex(star => getString(star.id) === starId);
      if (starIndex === -1) return fail('not_found', 'Location was not found.', 404);
      const updates = sanitizeValue(body.updates || {}) as Record<string, unknown>;
      const nextStars = stars.map((star, index) => {
        if (index !== starIndex) return star;
        const next = { ...star };
        Object.entries(updates).forEach(([key, value]) => {
          if (!writableStarKeys.has(key)) return;
          if ((key === 'lat' || key === 'lng') && !Number.isFinite(Number(value))) return;
          next[key] = value;
        });
        if (!isFiniteCoordinate(next.lat, next.lng)) return star;
        return next;
      });
      await saveState(admin, memory.userId, { ...memory.state, stars: nextStars });
      return json({ ok: true, location: starSummary(nextStars[starIndex], starIndex) });
    }

    if (action === 'add_note_to_star') {
      requireWrite(body);
      const starId = getString(body.starId);
      const starIndex = stars.findIndex(star => getString(star.id) === starId);
      if (starIndex === -1) return fail('not_found', 'Location was not found.', 404);
      const noteInput = sanitizeValue(body.note || {}) as Record<string, unknown>;
      const now = Date.now();
      const note: Record<string, unknown> = {
        id: createId('note'),
        content: getString(noteInput.content),
        contentHtml: sanitizeRichHtml(noteInput.contentHtml),
        imageUrls: getArray(noteInput.imageUrls),
        images: getArray(noteInput.images),
        fontSize: noteInput.fontSize,
        titleFontSize: noteInput.titleFontSize,
        color: getString(noteInput.color),
        createdAt: now,
        updatedAt: now,
      };
      const nextStars = stars.map((star, index) => (
        index === starIndex ? { ...star, notes: [...getNotes(star), note] } : star
      ));
      await saveState(admin, memory.userId, { ...memory.state, stars: nextStars });
      return json({ ok: true, note: noteSummary(note, nextStars[starIndex], starIndex, getNotes(nextStars[starIndex]).length - 1) });
    }

    if (action === 'update_note') {
      requireWrite(body);
      const starId = getString(body.starId);
      const noteId = getString(body.noteId);
      const starIndex = stars.findIndex(star => getString(star.id) === starId);
      if (starIndex === -1) return fail('not_found', 'Location was not found.', 404);
      const notes = getNotes(stars[starIndex]);
      const noteIndex = notes.findIndex(note => getString(note.id) === noteId);
      if (noteIndex === -1) return fail('not_found', 'Note was not found.', 404);
      const updates = sanitizeValue(body.updates || {}) as Record<string, unknown>;
      const nextNote: Record<string, unknown> = { ...notes[noteIndex], updatedAt: Date.now() };
      Object.entries(updates).forEach(([key, value]) => {
        if (!writableNoteKeys.has(key)) return;
        nextNote[key] = key === 'contentHtml' ? sanitizeRichHtml(value) : value;
      });
      const nextNotes = notes.map((note, index) => index === noteIndex ? nextNote : note);
      const nextStars = stars.map((star, index) => index === starIndex ? { ...star, notes: nextNotes } : star);
      await saveState(admin, memory.userId, { ...memory.state, stars: nextStars });
      return json({ ok: true, note: noteSummary(nextNote, nextStars[starIndex], starIndex, noteIndex) });
    }

    if (action === 'delete_note') {
      requireDelete(body);
      const starId = getString(body.starId);
      const noteId = getString(body.noteId);
      const starIndex = stars.findIndex(star => getString(star.id) === starId);
      if (starIndex === -1) return fail('not_found', 'Location was not found.', 404);
      const notes = getNotes(stars[starIndex]);
      const noteIndex = notes.findIndex(note => getString(note.id) === noteId);
      if (noteIndex === -1) return fail('not_found', 'Note was not found.', 404);
      const removedNote = notes[noteIndex];
      const nextNotes = notes.filter((_, index) => index !== noteIndex);
      const nextStars = stars.map((star, index) => index === starIndex ? { ...star, notes: nextNotes } : star);
      await saveState(admin, memory.userId, { ...memory.state, stars: nextStars });
      const media = await deleteMediaPaths(admin, collectMediaPathsFromNote(removedNote, memory.userId));
      return json({ ok: true, deletedNoteId: noteId, media });
    }

    if (action === 'delete_star') {
      requireDelete(body);
      const starId = getString(body.starId);
      const starIndex = stars.findIndex(star => getString(star.id) === starId);
      if (starIndex === -1) return fail('not_found', 'Location was not found.', 404);
      const removedStar = stars[starIndex];
      const removedTagOrder = getNumber(removedStar.tagOrder, 0);
      const removedGroupId = removedStar.tagGroupId;
      const mediaPaths = getNotes(removedStar).flatMap(note => collectMediaPathsFromNote(note, memory.userId));
      const nextStars = stars
        .filter((_, index) => index !== starIndex)
        .map(star => (
          removedTagOrder &&
          removedGroupId !== undefined &&
          star.tagGroupId === removedGroupId &&
          getNumber(star.tagOrder, 0) > removedTagOrder
            ? { ...star, tagOrder: getNumber(star.tagOrder) - 1 }
            : star
        ));
      await saveState(admin, memory.userId, { ...memory.state, stars: nextStars });
      const media = await deleteMediaPaths(admin, mediaPaths);
      return json({ ok: true, deletedStarId: starId, media });
    }

    if (action === 'delete_route') {
      requireDelete(body);
      const routeId = getString(body.routeId);
      const nextTracks = tracks.filter(track => getString(track.id) !== routeId);
      if (nextTracks.length === tracks.length) return fail('not_found', 'Route was not found.', 404);
      await saveState(admin, memory.userId, { ...memory.state, savedTracks: nextTracks });
      return json({ ok: true, deletedRouteId: routeId });
    }

    return fail('unknown_action', 'Unknown memory API action.', 400, {
      actions: [
        'search_memories',
        'list_locations',
        'get_location_memory',
        'get_day_memory',
        'get_routes',
        'summarize_memory_range',
        'export_memory_report',
        'create_star',
        'update_star',
        'add_note_to_star',
        'update_note',
        'delete_note',
        'delete_star',
        'delete_route',
      ],
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return fail('internal_error', error instanceof Error ? error.message : 'Unexpected memory API error.', 500);
  }
});
