// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  clientIp,
  createCorsHeaders,
  forbiddenOriginResponse,
  hitRateLimit,
  isOriginAllowed,
  rateLimitResponse,
  tokenPrefix,
} from '../_shared/security.ts';

let corsHeaders = {
  'Access-Control-Allow-Origin': 'https://kakizzzzz.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: unknown, status = 200) => (
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
);

const errorResponse = (code: string, message: string, status = 400) => (
  jsonResponse({ error: { code, message } }, status)
);

const getString = (value: unknown, fallback = '') => (
  typeof value === 'string' ? value : fallback
);

const tokenToClient = (row: Record<string, unknown>) => ({
  id: getString(row.id),
  name: getString(row.name, 'My Life Memory MCP'),
  tokenPrefix: getString(row.token_prefix),
  createdAt: getString(row.created_at),
  lastUsedAt: getString(row.last_used_at) || null,
  revokedAt: getString(row.revoked_at) || null,
});

const bytesToHex = (bytes: Uint8Array) => (
  Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
);

const createPlainToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `mlm_${bytesToHex(bytes)}`;
};

const sha256Hex = async (value: string) => {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(hash));
};

const getBearerToken = (request: Request) => {
  const authorization = request.headers.get('authorization') || '';
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
};

serve(async request => {
  if (!isOriginAllowed(request)) {
    return forbiddenOriginResponse();
  }

  corsHeaders = createCorsHeaders(request);

  const ipLimit = hitRateLimit(`mcp-token:${clientIp(request)}`, 60, 60_000);
  if (ipLimit.limited) {
    return rateLimitResponse(corsHeaders, ipLimit.retryAfterSeconds);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Method not allowed.', 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse('setup_required', 'MCP token service is not configured.', 500);
  }

  const userToken = getBearerToken(request);
  if (!userToken) {
    const limit = hitRateLimit(`mcp-token-auth-fail:${clientIp(request)}:none`, 20, 10 * 60_000);
    if (limit.limited) return rateLimitResponse(corsHeaders, limit.retryAfterSeconds);
    return errorResponse('unauthorized', 'A valid login session is required.', 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('bad_request', 'Invalid request body.', 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(userToken);
  if (userError || !userData.user) {
    const limit = hitRateLimit(`mcp-token-auth-fail:${clientIp(request)}:${tokenPrefix(userToken)}`, 10, 10 * 60_000);
    if (limit.limited) return rateLimitResponse(corsHeaders, limit.retryAfterSeconds);
    return errorResponse('unauthorized', 'A valid login session is required.', 401);
  }

  const userId = userData.user.id;
  const action = getString(body.action);

  if (action === 'list') {
    const { data, error } = await admin
      .from('mcp_tokens')
      .select('id,name,token_prefix,created_at,last_used_at,revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) return errorResponse('setup_required', error.message, 500);
    return jsonResponse({ ok: true, tokens: (data || []).map(tokenToClient) });
  }

  if (action === 'create') {
    const plainToken = createPlainToken();
    const tokenHash = await sha256Hex(plainToken);
    const tokenPrefix = `${plainToken.slice(0, 12)}...`;
    const name = getString(body.name, 'My Life Memory MCP').trim().slice(0, 80) || 'My Life Memory MCP';

    const { error: cleanupError } = await admin
      .from('mcp_tokens')
      .delete()
      .eq('user_id', userId);

    if (cleanupError) return errorResponse('setup_required', cleanupError.message, 500);

    const { data, error } = await admin
      .from('mcp_tokens')
      .insert({
        user_id: userId,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        name,
      })
      .select('id,name,token_prefix,created_at,last_used_at,revoked_at')
      .single();

    if (error) return errorResponse('setup_required', error.message, 500);
    return jsonResponse({ ok: true, token: plainToken, tokenInfo: tokenToClient(data) });
  }

  if (action === 'revoke') {
    const tokenId = getString(body.tokenId);
    if (!tokenId) return errorResponse('bad_request', 'Token ID is required.', 400);

    const { error } = await admin
      .from('mcp_tokens')
      .delete()
      .eq('id', tokenId)
      .eq('user_id', userId);

    if (error) return errorResponse('setup_required', error.message, 500);
    return jsonResponse({ ok: true });
  }

  return errorResponse('unknown_action', 'Unknown MCP token action.', 400);
});
