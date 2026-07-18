import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import { buildImageToolResult, encodeStorageObjectPath } from './image-content.mjs';
import {
  contextualSearchInput,
  mergeContextualSearchFallback,
  shouldUseContextualSearchFallback,
} from '../supabase/functions/_shared/mcp-query-routing.mjs';
import {
  buildMcpMemoryInstructions,
  MCP_SERVER_VERSION,
  RESEARCH_MEMORY_TOOL_DESCRIPTION,
  SEARCH_MEMORY_TOOL_DESCRIPTION,
} from '../supabase/functions/_shared/mcp-memory-contract.mjs';

const env = process.env;

const supabaseUrl = (env.MLM_SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const supabaseAnonKey = (env.MLM_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim();
const explicitAccessToken = (env.MLM_SUPABASE_ACCESS_TOKEN || '').trim();
const account = (env.MLM_ACCOUNT || '').trim().toLowerCase();
const password = env.MLM_PASSWORD || '';
const apiUrl = (env.MLM_MEMORY_API_URL || (supabaseUrl ? `${supabaseUrl}/functions/v1/memory-api` : '')).trim();

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

const searchMemoriesWithContextFallback = async input => {
  const exact = await callMemoryApi('search_memories', input);
  if (!shouldUseContextualSearchFallback(exact, input)) return exact;
  const contextual = await callMemoryApi('research_memory_context', contextualSearchInput(input));
  return mergeContextualSearchFallback(exact, contextual);
};

const getTokenUserId = token => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : '';
  } catch {
    return '';
  }
};

const getMemoryImageResult = async input => {
  const token = await getAccessToken();
  const userId = getTokenUserId(token);
  if (!userId) throw new Error('Could not resolve the authenticated user for image access.');
  const payload = await callMemoryApi('get_note_media', { noteIds: input.noteIds });
  return buildImageToolResult({
    userId,
    media: Array.isArray(payload?.media) ? payload.media : [],
    maxImages: input.maxImages,
    download: async (reference, signal, maxBytes) => {
      const url = `${supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(reference.bucket)}/${encodeStorageObjectPath(reference.path)}`;
      const response = await fetch(url, {
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) throw new Error(`storage_http_${response.status}`);
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('image_too_large');
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mimeType: response.headers.get('content-type') || reference.mimeType,
      };
    },
  });
};

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const semanticReview = z.object({
  decisions: z.array(z.object({
    noteId: z.string().min(1).max(200),
    verdict: z.enum(['supports', 'rejects', 'uncertain']),
    relation: z.enum(['home', 'work', 'study', 'observation', 'activity']),
    evidenceQuote: z.string().min(1).max(240),
  })).max(6),
}).optional();

export const createMemoryMcpServer = async () => {
  const temporalPayload = await callMemoryApi('get_temporal_context').catch(() => null);
  const server = new McpServer({
    name: 'my-life-memory',
    version: MCP_SERVER_VERSION,
  }, {
    instructions: buildMcpMemoryInstructions(temporalPayload?.temporalContext),
  });

  server.registerTool('research_memory_context', {
    title: 'Research Memory Context',
    description: RESEARCH_MEMORY_TOOL_DESCRIPTION,
    inputSchema: {
      query: z.string().min(1),
      place: z.string().max(160).optional(),
      region: z.string().max(160).optional(),
      dateFrom: optionalDate,
      dateTo: optionalDate,
      centerLat: z.number().min(-90).max(90).optional(),
      centerLng: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().min(0.1).max(1000).default(5),
      limit: z.number().int().min(1).max(100).default(30),
      semanticReview,
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
    },
  }, async input => textResult(await callMemoryApi('research_memory_context', input)));

  server.registerTool('get_memory_images', {
    title: 'Read Relevant Memory Photos',
    description: 'Return private image blocks for up to 10 authenticated-user note ids already returned by another memory tool. Call only for notes relevant to the user question and only when visual analysis is useful. Vision-capable clients may analyze returned image blocks; otherwise use image metadata and never claim to have seen the photos.',
    inputSchema: {
      noteIds: z.array(z.string().min(1).max(200)).min(1).max(10),
      maxImages: z.number().int().min(1).max(6).default(3),
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  }, getMemoryImageResult);

  server.registerTool('search_memories', {
    title: 'Search My Life Memory',
    description: SEARCH_MEMORY_TOOL_DESCRIPTION,
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
  }, async input => textResult(await searchMemoriesWithContextFallback(input)));

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
