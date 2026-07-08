// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
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
    name: 'search_memories',
    title: 'Search My Life Memory',
    description: 'Search the user memory notes, coordinates, and location ids.',
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
  },
  {
    name: 'list_locations',
    title: 'List Memory Locations',
    description: 'List all saved stars with coordinates, colors, timestamps, and note counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'get_location_memory',
    title: 'Get Location Memory',
    description: 'Read all notes and image metadata for one star/location.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
      },
      required: ['starId'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_day_memory',
    title: 'Get Day Memory',
    description: 'Read all memories for one local date.',
    inputSchema: {
      type: 'object',
      properties: {
        date: optionalDateSchema,
      },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_routes',
    title: 'Get Routes',
    description: 'Read saved GPS routes. Paths are omitted unless includePaths is true.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
        includePaths: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'summarize_memory_range',
    title: 'Summarize Memory Range',
    description: 'Return counts and top locations for a date range. The AI client can use this data to write its own summary.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'export_memory_report',
    title: 'Export Memory Report',
    description: 'Generate a readable HTML report string for the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

const writeTools = [
  {
    name: 'create_star',
    title: 'Create Memory Star',
    description: 'Create one star/location.',
    inputSchema: {
      type: 'object',
      properties: {
        lat: { type: 'number', minimum: -90, maximum: 90 },
        lng: { type: 'number', minimum: -180, maximum: 180 },
        color: { type: 'string' },
        note: {
          type: 'object',
          properties: {
            content: { type: 'string', default: '' },
            contentHtml: { type: 'string', default: '' },
          },
          additionalProperties: false,
        },
      },
      required: ['lat', 'lng'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_star',
    title: 'Update Memory Star',
    description: 'Move or recolor one star/location.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
        updates: {
          type: 'object',
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
            color: { type: 'string' },
            tagOrder: { type: 'number' },
            tagGroupId: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      required: ['starId', 'updates'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_note_to_star',
    title: 'Add Note To Star',
    description: 'Add a text note to one star/location.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
        note: {
          type: 'object',
          properties: {
            content: { type: 'string', default: '' },
            contentHtml: { type: 'string', default: '' },
            color: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['starId', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_note',
    title: 'Update Note',
    description: 'Update note text, html, color, images, or font settings. Creation time is not editable.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
        noteId: { type: 'string', minLength: 1 },
        updates: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            contentHtml: { type: 'string' },
            color: { type: 'string' },
            fontSize: { type: 'number' },
            titleFontSize: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      required: ['starId', 'noteId', 'updates'],
      additionalProperties: false,
    },
  },
];

const deleteTools = [
  {
    name: 'delete_note',
    title: 'Delete Note',
    description: 'Delete one note and its referenced storage media. Requires confirm=DELETE.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
        noteId: { type: 'string', minLength: 1 },
        confirm: { type: 'string', const: 'DELETE' },
      },
      required: ['starId', 'noteId', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_star',
    title: 'Delete Star',
    description: 'Delete one star, its notes, and referenced storage media. Requires confirm=DELETE.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
        confirm: { type: 'string', const: 'DELETE' },
      },
      required: ['starId', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_route',
    title: 'Delete Route',
    description: 'Delete one saved GPS route. Requires confirm=DELETE.',
    inputSchema: {
      type: 'object',
      properties: {
        routeId: { type: 'string', minLength: 1 },
        confirm: { type: 'string', const: 'DELETE' },
      },
      required: ['routeId', 'confirm'],
      additionalProperties: false,
    },
  },
];

const jsonResponse = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => (
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

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get('authorization') || '';
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
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
  const timeZone = Deno.env.get('MLM_TIME_ZONE') || 'Asia/Shanghai';
  const enableWrites = Deno.env.get('MLM_MCP_ENABLE_WRITES') === 'true';
  const enableDeletes = enableWrites && Deno.env.get('MLM_MCP_ENABLE_DELETES') === 'true';

  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    serviceRoleKey,
    supabaseAnonKey,
    memoryApiInternalToken,
    memoryApiUrl,
    timeZone,
    enableWrites,
    enableDeletes,
  };
};

const authenticateMcpRequest = async (request: Request, config: ReturnType<typeof getConfig>) => {
  const token = getBearerToken(request);
  if (!token) {
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
    throw new Response(JSON.stringify(rpcError(null, -32001, 'Unauthorized')), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error: updateError } = await admin
    .from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);
  if (updateError) console.warn('Could not update MCP token last_used_at:', updateError.message);

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
      timeZone: config.timeZone,
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

const availableTools = (config: ReturnType<typeof getConfig>) => [
  ...readTools,
  ...(config.enableWrites ? writeTools : []),
  ...(config.enableDeletes ? deleteTools : []),
];

const toolActionInput = (toolName: string, input: Record<string, unknown>) => {
  if (writeTools.some(tool => tool.name === toolName)) return { ...input, confirmWrite: true };
  if (deleteTools.some(tool => tool.name === toolName)) return { ...input, confirmWrite: true };
  return input;
};

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
    return rpcResult(id, {
      protocolVersion: getString(params.protocolVersion) || '2025-03-26',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'my-life-memory',
        version: '0.1.0',
      },
    });
  }

  if (method === 'ping') {
    return rpcResult(id, {});
  }

  if (method === 'tools/list') {
    return rpcResult(id, {
      tools: availableTools(config),
    });
  }

  if (method === 'tools/call') {
    const toolName = getString(params.name);
    const args = params.arguments && typeof params.arguments === 'object'
      ? params.arguments as Record<string, unknown>
      : {};
    const tools = availableTools(config);
    if (!tools.some(tool => tool.name === toolName)) {
      return rpcError(id, -32602, `Unknown or disabled tool: ${toolName}`);
    }
    const payload = await callMemoryApi(config, userId, toolName, toolActionInput(toolName, args));
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
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const config = getConfig();
  if (
    !config.supabaseUrl ||
    !config.serviceRoleKey ||
    !config.supabaseAnonKey ||
    !config.memoryApiInternalToken ||
    !config.memoryApiUrl
  ) {
    return jsonResponse(rpcError(null, -32000, 'MCP service is not configured.'), 500);
  }

  let auth: { userId: string };
  try {
    auth = await authenticateMcpRequest(request, config);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonResponse(rpcError(null, -32001, 'Unauthorized'), 401);
  }

  if (request.method === 'GET') {
    const accept = request.headers.get('accept') || '';
    if (!accept.includes('text/event-stream')) {
      return jsonResponse(rpcError(null, -32000, 'Not Acceptable: Client must accept text/event-stream'), 406);
    }
    return new Response('event: endpoint\ndata: /mcp\n\n', {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse(rpcError(null, -32000, 'Method not allowed'), 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error: Invalid JSON'), 400);
  }

  try {
    if (Array.isArray(body)) {
      const results = (await Promise.all(body.map(message => handleRpcMessage(message, config, auth.userId)))).filter(Boolean);
      return jsonResponse(results);
    }
    if (!body || typeof body !== 'object') {
      return jsonResponse(rpcError(null, -32600, 'Invalid Request'), 400);
    }
    const result = await handleRpcMessage(body as Record<string, unknown>, config, auth.userId);
    if (!result) return new Response(null, { status: 202, headers: corsHeaders });
    return jsonResponse(result);
  } catch (error) {
    const id = body && typeof body === 'object' && 'id' in body ? (body as Record<string, unknown>).id : null;
    return jsonResponse(rpcError(id, -32603, error instanceof Error ? error.message : 'Internal server error'), 500);
  }
});
