import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  clientIp,
  hitRateLimit,
  parseMcpAccessToken,
  rateLimitResponse,
  tokenPrefix,
} from '../_shared/security.ts';
import {
  buildMcpMemoryInstructions,
  MCP_SERVER_VERSION,
  RESEARCH_MEMORY_TOOL_DESCRIPTION,
  SEARCH_MEMORY_TOOL_DESCRIPTION,
} from '../_shared/mcp-memory-contract.mjs';
import {
  buildMcpImageContent,
  encodeStorageObjectPath,
  type MemoryImageReference,
} from '../_shared/mcp-image-content.ts';
import {
  contextualSearchInput,
  mergeContextualSearchFallback,
  shouldUseContextualSearchFallback,
} from '../_shared/mcp-query-routing.mjs';

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

const optionalDateSchema = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
};

const readTools = [
  {
    name: 'research_memory_context',
    title: 'Research Memory Context',
    description: RESEARCH_MEMORY_TOOL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        place: {
          type: 'string',
          maxLength: 160,
          description: 'Only the place name to resolve, such as Example City, Example Town, or Example Village. Use for cities, towns, villages, neighbourhoods, and administrative places.',
        },
        region: {
          type: 'string',
          maxLength: 160,
          description: 'Optional country or broader region used to disambiguate the place.',
        },
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
        centerLat: { type: 'number', minimum: -90, maximum: 90 },
        centerLng: { type: 'number', minimum: -180, maximum: 180 },
        radiusKm: { type: 'number', minimum: 0.1, maximum: 1000, default: 5 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'get_memory_images',
    title: 'Read Relevant Memory Photos',
    description: 'Return private image blocks for up to 10 authenticated-user note ids already returned by another memory tool. Call only for notes relevant to the user question and only when visual analysis is useful. Vision-capable clients may analyze returned image blocks; otherwise use image metadata and never claim to have seen the photos.',
    inputSchema: {
      type: 'object',
      properties: {
        noteIds: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 200 },
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
        },
        maxImages: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
      },
      required: ['noteIds'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'search_memories',
    title: 'Search My Life Memory',
    description: SEARCH_MEMORY_TOOL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', default: '' },
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'list_locations',
    title: 'List Memory Locations',
    description: 'List saved stars for the authenticated user. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_location_memory',
    title: 'Get Location Memory',
    description: 'Read notes and image metadata for one authenticated-user star/location. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
      },
      required: ['starId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_day_memory',
    title: 'Get Day Memory',
    description: 'Read memories for one local date. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {
        date: optionalDateSchema,
      },
      required: ['date'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_routes',
    title: 'Get Routes',
    description: 'Read saved GPS routes. Paths are omitted unless includePaths is true. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
        includePaths: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'summarize_memory_range',
    title: 'Summarize Memory Range',
    description: 'Return counts and top locations for a date range. The AI client may summarize only this returned data and must not invent missing records.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'export_memory_report',
    title: 'Export Memory Report',
    description: 'Generate a readable HTML report string for the authenticated user using only stored My Life Memory data.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];

const jsonResponse = (
  body: unknown,
  status = 200,
  corsHeaders: Record<string, string> = DEFAULT_CORS_HEADERS,
  extraHeaders: Record<string, string> = {},
) => (
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      'Content-Type': 'application/json',
    },
  })
);

const rpcResult = (id: unknown, result: unknown) => ({
  jsonrpc: '2.0',
  id,
  result,
});

const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: data === undefined ? { code, message } : { code, message, data },
});

const getString = (value: unknown) => (typeof value === 'string' ? value : '');

const bytesToHex = (bytes: Uint8Array) => (
  Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
);

const sha256Hex = async (value: string) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(hash));
};

const readJsonResponse = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getConfig = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('MLM_SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('MLM_SUPABASE_ANON_KEY') || '';
  const memoryApiInternalToken = Deno.env.get('MEMORY_API_INTERNAL_TOKEN') || '';
  const memoryApiUrl = Deno.env.get('MLM_MEMORY_API_URL') || (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/memory-api` : '');

  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    serviceRoleKey,
    supabaseAnonKey,
    memoryApiInternalToken,
    memoryApiUrl,
  };
};

const authenticateMcpRequest = async (
  request: Request,
  config: ReturnType<typeof getConfig>,
  corsHeaders: Record<string, string>,
) => {
  const authorization = request.headers.get('authorization') || '';
  const token = parseMcpAccessToken(authorization);
  if (!token) {
    console.warn('MCP authentication rejected', {
      reason: 'invalid_format',
      authorizationLength: authorization.trim().length,
      hasBearerScheme: /^Bearer\s+/i.test(authorization.trim()),
    });
    const limit = await hitRateLimit(`mcp-auth-fail:${clientIp(request)}:none`, 20, 10 * 60_000);
    if (limit.limited) throw rateLimitResponse(corsHeaders, limit.retryAfterSeconds);
    throw new Response(JSON.stringify(rpcError(null, -32001, 'Unauthorized')), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const tokenHash = await sha256Hex(token);
  const { data, error } = await admin
    .from('mcp_tokens')
    .select('id,user_id')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw new Response(JSON.stringify(rpcError(null, -32000, error.message || 'MCP token lookup failed.')), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!data?.user_id) {
    console.warn('MCP authentication rejected', {
      reason: 'hash_miss',
      tokenLength: token.length,
      tokenPrefix: tokenPrefix(token),
      tokenHashPrefix: tokenHash.slice(0, 12),
    });
    const limit = await hitRateLimit(`mcp-auth-fail:${clientIp(request)}:${tokenPrefix(token)}`, 10, 10 * 60_000);
    if (limit.limited) throw rateLimitResponse(corsHeaders, limit.retryAfterSeconds);
    throw new Response(JSON.stringify(rpcError(null, -32001, 'Unauthorized')), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { error: usageUpdateError } = await admin
      .from('mcp_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id);
    if (usageUpdateError) {
      console.warn('MCP token usage timestamp was not updated', {
        message: usageUpdateError.message,
      });
    }
  } catch (error) {
    console.warn('MCP token usage timestamp was not updated', {
      message: error instanceof Error ? error.message : 'Unknown update error',
    });
  }

  return {
    userId: data.user_id,
  };
};

const callMemoryApi = async (config: ReturnType<typeof getConfig>, userId: string, action: string, input: Record<string, unknown> = {}) => {
  const response = await fetch(config.memoryApiUrl, {
    method: 'POST',
    headers: {
      apikey: config.supabaseAnonKey,
      'x-memory-api-internal-token': config.memoryApiInternalToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      userId,
      ...input,
      action,
    }),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || payload?.error) {
    const error = payload?.error || payload || {};
    throw new Error(error.message || error.msg || `Memory API failed with HTTP ${response.status}`);
  }
  return payload;
};

const downloadPrivateMemoryImage = async (
  config: ReturnType<typeof getConfig>,
  reference: MemoryImageReference,
  signal: AbortSignal,
  maxBytes: number,
) => {
  const objectUrl = `${config.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(reference.bucket)}/${encodeStorageObjectPath(reference.path)}`;
  const response = await fetch(objectUrl, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
    },
    signal,
  });
  if (!response.ok) throw new Error(`storage_http_${response.status}`);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('image_too_large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    mimeType: response.headers.get('content-type') || reference.mimeType,
  };
};

const availableTools = () => readTools;

const handleRpcMessage = async (message: Record<string, unknown>, config: ReturnType<typeof getConfig>, userId: string) => {
  const id = message.id;
  const method = getString(message.method);
  const params = message.params && typeof message.params === 'object'
    ? message.params as Record<string, unknown>
    : {};

  if (!id && method.startsWith('notifications/')) {
    return null;
  }

  if (method === 'initialize') {
    const temporalPayload = await callMemoryApi(config, userId, 'get_temporal_context', {}).catch(() => null);
    return rpcResult(id, {
      protocolVersion: getString(params.protocolVersion) || '2025-03-26',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'my-life-memory',
        version: MCP_SERVER_VERSION,
      },
      instructions: buildMcpMemoryInstructions(temporalPayload?.temporalContext),
    });
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  if (method === 'tools/list') {
    return rpcResult(id, {
      tools: availableTools(),
    });
  }

  if (method === 'tools/call') {
    const toolName = getString(params.name);
    const args = params.arguments && typeof params.arguments === 'object'
      ? params.arguments as Record<string, unknown>
      : {};
    const tools = availableTools();
    if (!tools.some(tool => tool.name === toolName)) {
      return rpcError(id, -32602, `Unknown or disabled tool: ${toolName}`);
    }
    if (toolName === 'get_memory_images') {
      const payload = await callMemoryApi(config, userId, 'get_note_media', {
        noteIds: args.noteIds,
      });
      const media = Array.isArray(payload?.media)
        ? payload.media as MemoryImageReference[]
        : [];
      const result = await buildMcpImageContent({
        userId,
        media,
        maxImages: Number(args.maxImages) || 3,
        download: (reference, signal, maxBytes) => (
          downloadPrivateMemoryImage(config, reference, signal, maxBytes)
        ),
      });
      return rpcResult(id, { content: result.content });
    }
    let payload = await callMemoryApi(config, userId, toolName, args);
    if (toolName === 'search_memories' && shouldUseContextualSearchFallback(payload, args)) {
      const contextual = await callMemoryApi(
        config,
        userId,
        'research_memory_context',
        contextualSearchInput(args),
      );
      payload = mergeContextualSearchFallback(payload, contextual);
    }
    return rpcResult(id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    });
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
};

serve(async request => {
  // Native MCP clients use null, custom, or no Origin. This remote endpoint is
  // protected by a per-user bearer token, while browser-facing functions keep
  // their stricter ALLOWED_ORIGINS checks.
  const localCorsHeaders = DEFAULT_CORS_HEADERS;
  const json = (
    body: unknown,
    status = 200,
    extraHeaders: Record<string, string> = {},
  ) => jsonResponse(body, status, localCorsHeaders, extraHeaders);

  const ipLimit = await hitRateLimit(`mcp:${clientIp(request)}`, 240, 60_000);
  if (ipLimit.limited) {
    return rateLimitResponse(localCorsHeaders, ipLimit.retryAfterSeconds);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: localCorsHeaders });
  }

  const config = getConfig();
  if (
    !config.supabaseUrl ||
    !config.serviceRoleKey ||
    !config.supabaseAnonKey ||
    !config.memoryApiInternalToken ||
    !config.memoryApiUrl
  ) {
    return json(rpcError(null, -32000, 'MCP service is not configured.'), 500);
  }

  let auth: { userId: string };
  try {
    auth = await authenticateMcpRequest(request, config, localCorsHeaders);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('MCP authentication failed unexpectedly', {
      message: error instanceof Error ? error.message : 'Unknown authentication error',
    });
    return json(rpcError(null, -32000, 'MCP authentication failed unexpectedly.'), 500);
  }

  if (request.method === 'GET') {
    return json(
      rpcError(null, -32000, 'This server uses JSON-response Streamable HTTP over POST.'),
      405,
      { Allow: 'POST, OPTIONS' },
    );
  }

  if (request.method !== 'POST') {
    return json(rpcError(null, -32000, 'Method not allowed'), 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(rpcError(null, -32700, 'Parse error: Invalid JSON'), 400);
  }

  try {
    if (Array.isArray(body)) {
      const results = (await Promise.all(body.map(message => handleRpcMessage(message, config, auth.userId)))).filter(Boolean);
      return json(results);
    }
    if (!body || typeof body !== 'object') {
      return json(rpcError(null, -32600, 'Invalid Request'), 400);
    }
    const result = await handleRpcMessage(body as Record<string, unknown>, config, auth.userId);
    if (!result) return new Response(null, { status: 202, headers: localCorsHeaders });
    return json(result);
  } catch (error) {
    const id = body && typeof body === 'object' && 'id' in body ? (body as Record<string, unknown>).id : null;
    return json(rpcError(id, -32603, error instanceof Error ? error.message : 'Internal server error'), 500);
  }
});
