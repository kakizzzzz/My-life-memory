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
} from '../supabase/functions/_shared/mcp-memory-contract.mjs';
import { getMcpToolDefinition } from '../supabase/functions/_shared/mcp-tool-manifest.mjs';
import {
  createMemoryApiRequestError,
  MEMORY_API_INTERNAL_ERROR_MESSAGE,
} from '../supabase/functions/_shared/mcp-tool-runtime.mjs';
import { assertValidMcpToolArguments } from '../supabase/functions/_shared/mcp-tool-validation.mjs';
import { memoryResearchOutputSchema } from './memory-output-schema.mjs';

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

export const createLocalMemoryApiCaller = ({
  fetchImpl = fetch,
  accessTokenProvider = getAccessToken,
  endpoint = apiUrl,
  apiKey = supabaseAnonKey,
} = {}) => async (action, input = {}) => {
  const token = await accessTokenProvider();
  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...input,
        action,
      }),
    });
    payload = await readResponseJson(response);
  } catch {
    throw new Error(MEMORY_API_INTERNAL_ERROR_MESSAGE);
  }
  if (!response.ok || payload?.error) {
    throw createMemoryApiRequestError(response.status, payload);
  }
  return payload;
};

const callMemoryApi = createLocalMemoryApiCaller();

const textResult = value => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const memoryResearchText = value => (
  value?.status === 'supported'
    ? JSON.stringify(value, null, 2)
    : String(value?.directive?.exactText || '')
);

const memoryResearchResult = value => ({
  content: [{ type: 'text', text: memoryResearchText(value) }],
  structuredContent: value,
});

const searchMemoriesWithContextFallback = async (input, memoryApiCaller) => {
  const exact = await memoryApiCaller('search_memories', input);
  if (!shouldUseContextualSearchFallback(exact, input)) return exact;
  const contextual = await memoryApiCaller('research_memory_context', contextualSearchInput(input));
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

const getMemoryImageResult = async (input, memoryApiCaller) => {
  const token = await getAccessToken();
  const userId = getTokenUserId(token);
  if (!userId) throw new Error('Could not resolve the authenticated user for image access.');
  const payload = await memoryApiCaller('get_note_media', { noteIds: input.noteIds });
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

const localToolConfig = (name, outputSchema) => {
  const definition = getMcpToolDefinition(name);
  let inputSchema = z.fromJSONSchema(definition.inputSchema);
  const noteIdsSchema = definition.inputSchema.properties?.noteIds;
  if (noteIdsSchema?.uniqueItems === true && inputSchema.shape?.noteIds) {
    inputSchema = inputSchema.extend({
      noteIds: inputSchema.shape.noteIds.meta({ uniqueItems: true }),
    });
  }
  return {
    title: definition.title,
    description: definition.description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    annotations: definition.annotations,
  };
};

const validatedLocalInput = (name, input = {}) => assertValidMcpToolArguments(name, input);

export const createMemoryMcpServer = async ({ memoryApiCaller = callMemoryApi } = {}) => {
  const temporalPayload = await memoryApiCaller('get_temporal_context').catch(() => null);
  const server = new McpServer({
    name: 'my-life-memory',
    version: MCP_SERVER_VERSION,
  }, {
    instructions: buildMcpMemoryInstructions(temporalPayload?.temporalContext),
  });

  server.registerTool(
    'research_memory_context',
    localToolConfig('research_memory_context', memoryResearchOutputSchema),
    async input => memoryResearchResult(await memoryApiCaller(
      'research_memory_context',
      validatedLocalInput('research_memory_context', input),
    )),
  );

  server.registerTool(
    'get_memory_images',
    localToolConfig('get_memory_images'),
    input => getMemoryImageResult(validatedLocalInput('get_memory_images', input), memoryApiCaller),
  );

  server.registerTool('search_memories', localToolConfig('search_memories'), async input => {
    const result = await searchMemoriesWithContextFallback(
      validatedLocalInput('search_memories', input),
      memoryApiCaller,
    );
    return result?.resolvedAction === 'research_memory_context'
      ? { content: [{ type: 'text', text: memoryResearchText(result) }] }
      : textResult(result);
  });

  server.registerTool(
    'list_locations',
    localToolConfig('list_locations'),
    async input => {
      validatedLocalInput('list_locations', input);
      return textResult(await memoryApiCaller('list_locations'));
    },
  );

  server.registerTool(
    'get_location_memory',
    localToolConfig('get_location_memory'),
    async input => textResult(await memoryApiCaller(
      'get_location_memory',
      validatedLocalInput('get_location_memory', input),
    )),
  );

  server.registerTool(
    'get_day_memory',
    localToolConfig('get_day_memory'),
    async input => textResult(await memoryApiCaller(
      'get_day_memory',
      validatedLocalInput('get_day_memory', input),
    )),
  );

  server.registerTool(
    'get_routes',
    localToolConfig('get_routes'),
    async input => textResult(await memoryApiCaller(
      'get_routes',
      validatedLocalInput('get_routes', input),
    )),
  );

  server.registerTool(
    'summarize_memory_range',
    localToolConfig('summarize_memory_range'),
    async input => textResult(await memoryApiCaller(
      'summarize_memory_range',
      validatedLocalInput('summarize_memory_range', input),
    )),
  );

  server.registerTool(
    'export_memory_report',
    localToolConfig('export_memory_report'),
    async input => {
      validatedLocalInput('export_memory_report', input);
      return textResult(await memoryApiCaller('export_memory_report'));
    },
  );

  return server;
};
