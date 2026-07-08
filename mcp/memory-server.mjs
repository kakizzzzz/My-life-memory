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
    description: 'Search the authenticated user memory notes, coordinates, and location ids. Answer only from returned data. If count is 0, do not infer or invent.',
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
    description: 'List saved stars for the authenticated user. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async () => textResult(await callMemoryApi('list_locations')));

  server.registerTool('get_location_memory', {
    title: 'Get Location Memory',
    description: 'Read notes and image metadata for one authenticated-user star/location. Answer only from returned data. If count is 0, do not infer or invent.',
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
    description: 'Read memories for one local date. Answer only from returned data. If count is 0, do not infer or invent.',
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
    description: 'Read saved GPS routes. Paths are omitted unless includePaths is true. Answer only from returned data. If count is 0, do not infer or invent.',
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
    description: 'Return counts and top locations for a date range. The AI client may summarize only this returned data and must not invent missing records.',
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
    description: 'Generate a readable HTML report string for the authenticated user using only stored My Life Memory data.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, async () => textResult(await callMemoryApi('export_memory_report')));

  return server;
};
