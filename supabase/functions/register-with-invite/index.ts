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
} from '../_shared/security.ts';

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://kakizzzzz.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const sensitiveStateKeys = new Set([
  'password', 'loginpassword', 'registerpassword', 'currentpassword',
  'newpassword', 'confirmpassword', 'invitecode',
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

const normalizeAccountId = (accountId: unknown) => (
  typeof accountId === 'string' ? accountId.trim().toLowerCase() : ''
);

const accountIdToAuthEmail = (accountId: string) => {
  const bytes = new TextEncoder().encode(normalizeAccountId(accountId));
  const hex = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `u_${hex}@accounts.my-life-memory.app`;
};

const sanitizeCloudValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeCloudValue);
  if (!value || typeof value !== 'object') return value;
  const sanitized: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (!sensitiveStateKeys.has(key.toLowerCase())) sanitized[key] = sanitizeCloudValue(entry);
  });
  return sanitizeHtmlFields(sanitized);
};

const getString = (value: unknown) => (
  typeof value === 'string' ? value : ''
);

serve(async request => {
  if (!isOriginAllowed(request)) {
    return forbiddenOriginResponse();
  }

  const localCorsHeaders = createCorsHeaders(request);
  const json = (body: unknown, status = 200) => jsonResponse(body, status, localCorsHeaders);

  const ipLimit = await hitRateLimit(`register:${clientIp(request)}`, 30, 60_000);
  if (ipLimit.limited) {
    return rateLimitResponse(localCorsHeaders, ipLimit.retryAfterSeconds);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: localCorsHeaders });
  }

  if (request.method !== 'POST') {
    return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const inviteSecret = Deno.env.get('INVITE_CODE') || '';

  if (!supabaseUrl || !serviceRoleKey || !inviteSecret) {
    return json({ error: { code: 'setup_required', message: 'Registration service is not configured.' } }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: 'bad_request', message: 'Invalid request body.' } }, 400);
  }

  const normalizedAccount = normalizeAccountId(body.account);
  const password = getString(body.password);
  const inviteCode = getString(body.inviteCode);
  const initialProfile = body.initialProfile && typeof body.initialProfile === 'object'
    ? body.initialProfile as Record<string, unknown>
    : {};
  const initialState = body.initialState && typeof body.initialState === 'object'
    ? body.initialState as Record<string, unknown>
    : {};

  if (!inviteCode || inviteCode !== inviteSecret) {
    const failLimit = await hitRateLimit(`register-invite-fail:${clientIp(request)}:${normalizedAccount || 'none'}`, 5, 10 * 60_000);
    if (failLimit.limited) return rateLimitResponse(localCorsHeaders, failLimit.retryAfterSeconds);
    return json({ error: { code: 'invalid_invite', message: 'Invite code is invalid.' } }, 403);
  }

  if (!normalizedAccount || !password) {
    return json({ error: { code: 'missing_credentials', message: 'Account and password are required.' } }, 400);
  }

  if (password.length < 6) {
    return json({ error: { code: 'weak_password', message: 'Password must be at least 6 characters.' } }, 422);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data: existingProfile, error: existingProfileError } = await admin
    .from('profiles')
    .select('id')
    .eq('account_id', normalizedAccount)
    .maybeSingle();

  if (existingProfileError) {
    return json({ error: { code: 'setup_required', message: 'Could not check account.' } }, 500);
  }

  if (existingProfile) {
    return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
  }

  const email = accountIdToAuthEmail(normalizedAccount);
  const name = getString(initialProfile.name);
  const avatarUrl = getString(initialProfile.avatarUrl);
  const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      account_id: normalizedAccount,
      name,
    },
  });

  if (createUserError || !createdUser.user) {
    const message = createUserError?.message?.toLowerCase() || '';
    if (
      message.includes('already') ||
      message.includes('exists') ||
      message.includes('registered') ||
      message.includes('duplicate')
    ) {
      return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }
    if (message.includes('password')) {
      return json({ error: { code: 'weak_password', message: 'Password must be at least 6 characters.' } }, 422);
    }
    return json({ error: { code: 'setup_required', message: 'Could not create account.' } }, 500);
  }

  const userId = createdUser.user.id;
  const initialStars = Array.isArray(initialState.stars)
    ? initialState.stars.filter(star => star && typeof star === 'object') as Record<string, unknown>[]
    : [];
  const defaultStar = initialStars[0];
  if (!defaultStar) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return json({ error: { code: 'setup_required', message: 'Could not create the default memory location.' } }, 500);
  }

  const { error: initializeError } = await admin.rpc('initialize_normalized_memory_account', {
    p_user_id: userId,
    p_account_id: normalizedAccount,
    p_name: name,
    p_avatar_url: avatarUrl,
    p_settings: {
      mapStyle: getString(initialState.mapStyle) || 'light',
      systemTheme: initialState.systemTheme && typeof initialState.systemTheme === 'object'
        ? sanitizeCloudValue(initialState.systemTheme)
        : {},
      language: getString(initialState.language) || 'en',
      profileConflicts: Array.isArray(initialState.profileConflicts)
        ? sanitizeCloudValue(initialState.profileConflicts)
        : [],
      profileMetadata: {},
    },
    p_default_star: defaultStar,
  });

  if (initializeError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    const message = initializeError.message.toLowerCase();
    if (message.includes('duplicate') || message.includes('unique')) {
      return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }
    return json({ error: { code: 'setup_required', message: 'Could not initialize normalized memory storage.' } }, 500);
  }

  return json({
    ok: true,
    userId,
    account: normalizedAccount,
  });
});
