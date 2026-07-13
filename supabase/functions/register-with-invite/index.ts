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

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

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
  const findAuthUserByEmail = async (email: string) => {
    const perPage = 1000;
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const match = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
      if (match) return match;
      if (data.users.length < perPage) return null;
    }
    throw new Error('Auth user lookup exceeded the safe pagination limit.');
  };
  const rollbackAuthUser = async (userId: string) => {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const deletion = await admin.auth.admin.deleteUser(userId, false);
      const verification = await admin.auth.admin.getUserById(userId);
      const verificationMessage = verification.error?.message || '';
      const isConfirmedMissing = !verification.data.user && (
        !verification.error || /not found|does not exist/i.test(verificationMessage)
      );
      if (isConfirmedMissing) return true;

      lastError = deletion.error?.message || verificationMessage || 'Auth user still exists.';
      if (attempt < 2) await wait(250 * (attempt + 1));
    }

    console.error(JSON.stringify({
      event: 'registration_rollback_failed',
      userId,
      message: lastError || 'Auth user still exists after rollback attempts.',
    }));
    return false;
  };

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
  let authUser: Awaited<ReturnType<typeof findAuthUserByEmail>> = null;
  try {
    authUser = await findAuthUserByEmail(email);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'registration_auth_lookup_failed',
      message: error instanceof Error ? error.message : String(error),
    }));
    return json({ error: { code: 'setup_required', message: 'Could not check account authentication state.' } }, 500);
  }

  if (authUser) {
    const { data: authProfile, error: authProfileError } = await admin
      .from('profiles')
      .select('id')
      .eq('id', authUser.id)
      .maybeSingle();
    if (authProfileError) {
      return json({ error: { code: 'setup_required', message: 'Could not check incomplete account state.' } }, 500);
    }
    if (authProfile) {
      return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }

    const { data: recovered, error: recoverError } = await admin.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...authUser.user_metadata,
        account_id: normalizedAccount,
        name,
        registration_pending: true,
      },
    });
    if (recoverError || !recovered.user) {
      return json({ error: { code: 'registration_recovery_failed', message: 'Could not recover the incomplete account.' } }, 500);
    }
    authUser = recovered.user;
  } else {
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        account_id: normalizedAccount,
        name,
        registration_pending: true,
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
    authUser = createdUser.user;
  }

  const userId = authUser.id;
  const initialStars = Array.isArray(initialState.stars)
    ? initialState.stars.filter(star => star && typeof star === 'object') as Record<string, unknown>[]
    : [];
  const defaultStar = initialStars[0];
  if (!defaultStar) {
    const rolledBack = await rollbackAuthUser(userId);
    if (!rolledBack) {
      return json({ error: { code: 'registration_rollback_failed', message: 'Account initialization failed and requires recovery.' } }, 500);
    }
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
    const rolledBack = await rollbackAuthUser(userId);
    if (!rolledBack) {
      return json({ error: { code: 'registration_rollback_failed', message: 'Account initialization failed and requires recovery.' } }, 500);
    }
    const message = initializeError.message.toLowerCase();
    if (message.includes('duplicate') || message.includes('unique')) {
      return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }
    return json({ error: { code: 'setup_required', message: 'Could not initialize normalized memory storage.' } }, 500);
  }

  const { error: finalizeMetadataError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...authUser.user_metadata,
      account_id: normalizedAccount,
      name,
      registration_pending: false,
    },
  });
  if (finalizeMetadataError) {
    console.warn(JSON.stringify({
      event: 'registration_metadata_finalize_failed',
      userId,
      message: finalizeMetadataError.message,
    }));
  }

  return json({
    ok: true,
    userId,
    account: normalizedAccount,
  });
});
