// @ts-nocheck
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
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

const jsonResponse = (body: unknown, status = 200) => (
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
  if (Array.isArray(value)) return value.map(item => sanitizeCloudValue(item));
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (sensitiveStateKeys.has(key.toLowerCase())) return;
    sanitized[key] = sanitizeCloudValue(entry);
  });
  return sanitized;
};

const getString = (value: unknown) => (
  typeof value === 'string' ? value : ''
);

serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const inviteSecret = Deno.env.get('INVITE_CODE') || '';

  if (!supabaseUrl || !serviceRoleKey || !inviteSecret) {
    return jsonResponse({ error: { code: 'setup_required', message: 'Registration service is not configured.' } }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: { code: 'bad_request', message: 'Invalid request body.' } }, 400);
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
    return jsonResponse({ error: { code: 'invalid_invite', message: 'Invite code is invalid.' } }, 403);
  }

  if (!normalizedAccount || !password) {
    return jsonResponse({ error: { code: 'missing_credentials', message: 'Account and password are required.' } }, 400);
  }

  if (password.length < 6) {
    return jsonResponse({ error: { code: 'weak_password', message: 'Password must be at least 6 characters.' } }, 422);
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
    return jsonResponse({ error: { code: 'setup_required', message: 'Could not check account.' } }, 500);
  }

  if (existingProfile) {
    return jsonResponse({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
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
      return jsonResponse({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }
    if (message.includes('password')) {
      return jsonResponse({ error: { code: 'weak_password', message: 'Password must be at least 6 characters.' } }, 422);
    }
    return jsonResponse({ error: { code: 'setup_required', message: 'Could not create account.' } }, 500);
  }

  const userId = createdUser.user.id;
  const sanitizedState = sanitizeCloudValue(initialState) as Record<string, unknown>;
  const { error: profileError } = await admin
    .from('profiles')
    .insert({
      id: userId,
      account_id: normalizedAccount,
      name,
      avatar_url: avatarUrl,
    });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    const message = profileError.message.toLowerCase();
    if (message.includes('duplicate') || message.includes('unique')) {
      return jsonResponse({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }
    return jsonResponse({ error: { code: 'setup_required', message: 'Could not create profile.' } }, 500);
  }

  const { error: stateError } = await admin
    .from('app_states')
    .insert({
      user_id: userId,
      state: sanitizedState,
    });

  if (stateError) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return jsonResponse({ error: { code: 'setup_required', message: 'Could not create app state.' } }, 500);
  }

  return jsonResponse({
    ok: true,
    userId,
    account: normalizedAccount,
  });
});
