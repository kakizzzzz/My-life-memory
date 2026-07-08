import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

const env = process.env;

const supabaseUrl = (env.MLM_SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const supabaseAnonKey = (env.MLM_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
const explicitAccessToken = (env.MLM_SUPABASE_ACCESS_TOKEN || '').trim();
const account = (env.MLM_ACCOUNT || '').trim().toLowerCase();
const password = env.MLM_PASSWORD || '';
const apiUrl = (env.MLM_MEMORY_API_URL || (supabaseUrl ? `${supabaseUrl}/functions/v1/memory-api` : '')).trim();
const defaultTimeZone = env.MLM_TIME_ZONE || 'Asia/Shanghai';
const enableWrites = env.MLM_MCP_ENABLE_WRITES === 'true';
const enableDeletes = enableWrites && env.MLM_MCP_ENABLE_DELETES === 'true';

let cachedSession = null;

const accountToEmail = value => {
  const normalized = String(value || '').trim().toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const hex = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `u_${hex}@accounts.my-life-memory.app`;
};

const ensureConfig = () => {
  if (!supabaseUrl) throw new Error('Missing MLM_SUPABASE_URL.');
  if (!supabaseAnonKey) throw new Error('Missing MLM_SUPABASE_ANON_KEY.');
  if (!apiUrl) throw new Error('Missing MLM_MEMORY_API_URL.');
  if (!explicitAccessToken && (!account || !password)) {
    throw new Error('Set MLM_SUPABASE_ACCESS_TOKEN, or set MLM_ACCOUNT and MLM_PASSWORD.');
  }
};

const readResponseJson = async response => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getAccessToken = async () => {
  ensureConfig();
  if (explicitAccessToken) return explicitAccessToken;

  const now = Math.floor(Date.now() / 1000);
  if (cachedSession?.accessToken && cachedSession.expiresAt > now + 60) {
    return cachedSession.accessToken;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: accountToEmail(account),
      password,
    }),
  });
  const payload = await readResponseJson(response);
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.msg || payload?.message || payload?.error_description || 'Could not sign in to My Life Memory.');
  }

  cachedSession = {
    accessToken: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600),
  };
  return cachedSession.accessToken;
};

const callMemoryApi = async (action, input = {}) => {
  const token = await getAccessToken();
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeZone: defaultTimeZone,
      ...input,
      action,
    }),
  });
  const payload = await readResponseJson(response);
  if (!response.ok || payload?.error) {
    const error = payload?.error || payload || {};
    throw new Error(error.message || error.msg || `Memory API failed with HTTP ${response.status}`);
  }
  return payload;
};

const textResult = value => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const createMemoryMcpServer = () => {
  const server = new McpServer({
    name: 'my-life-memory',
    version: '0.1.0',
  });

  server.registerTool('search_memories', {
    title: 'Search My Life Memory',
    description: 'Search the user memory notes, coordinates, and location ids.',
    inputSchema: {
      query: z.string().default(''),
      dateFrom: optionalDate,
      dateTo: optionalDate,
      limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async input => textResult(await callMemoryApi('search_memories', input)));

  server.registerTool('list_locations', {
    title: 'List Memory Locations',
    description: 'List all saved stars with coordinates, colors, timestamps, and note counts.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async () => textResult(await callMemoryApi('list_locations')));

  server.registerTool('get_location_memory', {
    title: 'Get Location Memory',
    description: 'Read all notes and image metadata for one star/location.',
    inputSchema: {
      starId: z.string().min(1),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async input => textResult(await callMemoryApi('get_location_memory', input)));

  server.registerTool('get_day_memory', {
    title: 'Get Day Memory',
    description: 'Read all memories for one local date.',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async input => textResult(await callMemoryApi('get_day_memory', input)));

  server.registerTool('get_routes', {
    title: 'Get Routes',
    description: 'Read saved GPS routes. Paths are omitted unless includePaths is true.',
    inputSchema: {
      dateFrom: optionalDate,
      dateTo: optionalDate,
      includePaths: z.boolean().default(false),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async input => textResult(await callMemoryApi('get_routes', input)));

  server.registerTool('summarize_memory_range', {
    title: 'Summarize Memory Range',
    description: 'Return counts and top locations for a date range. The AI client can use this data to write its own summary.',
    inputSchema: {
      dateFrom: optionalDate,
      dateTo: optionalDate,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async input => textResult(await callMemoryApi('summarize_memory_range', input)));

  server.registerTool('export_memory_report', {
    title: 'Export Memory Report',
    description: 'Generate a readable HTML report string for the authenticated user.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async () => textResult(await callMemoryApi('export_memory_report')));

  if (enableWrites) {
    server.registerTool('create_star', {
      title: 'Create Memory Star',
      description: 'Create one star/location. Writes are disabled unless MLM_MCP_ENABLE_WRITES=true.',
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        color: z.string().optional(),
        note: z.object({
          content: z.string().default(''),
          contentHtml: z.string().default(''),
        }).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    }, async input => textResult(await callMemoryApi('create_star', { ...input, confirmWrite: true })));

    server.registerTool('update_star', {
      title: 'Update Memory Star',
      description: 'Move or recolor one star/location.',
      inputSchema: {
        starId: z.string().min(1),
        updates: z.object({
          lat: z.number().min(-90).max(90).optional(),
          lng: z.number().min(-180).max(180).optional(),
          color: z.string().optional(),
          tagOrder: z.number().optional(),
          tagGroupId: z.number().optional(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    }, async input => textResult(await callMemoryApi('update_star', { ...input, confirmWrite: true })));

    server.registerTool('add_note_to_star', {
      title: 'Add Note To Star',
      description: 'Add a text note to one star/location.',
      inputSchema: {
        starId: z.string().min(1),
        note: z.object({
          content: z.string().default(''),
          contentHtml: z.string().default(''),
          color: z.string().optional(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    }, async input => textResult(await callMemoryApi('add_note_to_star', { ...input, confirmWrite: true })));

    server.registerTool('update_note', {
      title: 'Update Note',
      description: 'Update note text, html, color, images, or font settings. Creation time is not editable.',
      inputSchema: {
        starId: z.string().min(1),
        noteId: z.string().min(1),
        updates: z.object({
          content: z.string().optional(),
          contentHtml: z.string().optional(),
          color: z.string().optional(),
          fontSize: z.number().optional(),
          titleFontSize: z.number().optional(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    }, async input => textResult(await callMemoryApi('update_note', { ...input, confirmWrite: true })));
  }

  if (enableDeletes) {
    server.registerTool('delete_note', {
      title: 'Delete Note',
      description: 'Delete one note and its referenced storage media. Requires confirm=DELETE.',
      inputSchema: {
        starId: z.string().min(1),
        noteId: z.string().min(1),
        confirm: z.literal('DELETE'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    }, async input => textResult(await callMemoryApi('delete_note', { ...input, confirmWrite: true })));

    server.registerTool('delete_star', {
      title: 'Delete Star',
      description: 'Delete one star, its notes, and referenced storage media. Requires confirm=DELETE.',
      inputSchema: {
        starId: z.string().min(1),
        confirm: z.literal('DELETE'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    }, async input => textResult(await callMemoryApi('delete_star', { ...input, confirmWrite: true })));

    server.registerTool('delete_route', {
      title: 'Delete Route',
      description: 'Delete one saved GPS route. Requires confirm=DELETE.',
      inputSchema: {
        routeId: z.string().min(1),
        confirm: z.literal('DELETE'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    }, async input => textResult(await callMemoryApi('delete_route', { ...input, confirmWrite: true })));
  }

  return server;
};
