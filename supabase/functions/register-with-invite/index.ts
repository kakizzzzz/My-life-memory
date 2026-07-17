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
import { normalizeTimeZone } from '../_shared/time-zone.ts';

const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://kakizzzzz.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_PASSWORD_LENGTH = 8;
const PRIVACY_NOTICE_VERSION = '2026-07-13';

const sensitiveStateKeys = new Set([
  'password', 'loginpassword', 'registerpassword', 'currentpassword',
  'newpassword', 'confirmpassword', 'passwordconfirmation', 'registerconfirmpassword', 'invitecode',
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const inviteSecret = Deno.env.get('INVITE_CODE') || '';

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !inviteSecret) {
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
  const passwordConfirmation = getString(body.passwordConfirmation);
  const inviteCode = getString(body.inviteCode);
  const privacyAccepted = body.privacyAccepted === true;
  const privacyVersion = getString(body.privacyVersion).trim();
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

  if (!normalizedAccount || !password || !passwordConfirmation) {
    return json({ error: { code: 'missing_credentials', message: 'Account and both password fields are required.' } }, 400);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: { code: 'weak_password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` } }, 422);
  }

  if (password !== passwordConfirmation) {
    return json({ error: { code: 'password_mismatch', message: 'The password confirmation does not match.' } }, 422);
  }

  if (!privacyAccepted || privacyVersion !== PRIVACY_NOTICE_VERSION) {
    return json({ error: { code: 'privacy_consent_required', message: 'The current privacy notice must be accepted before registration.' } }, 422);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const passwordVerifier = createClient(supabaseUrl, anonKey, {
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
  const getInitializationStatus = async (userId: string) => {
    const [profileResult, settingsResult, consentResult] = await Promise.all([
      admin.from('profiles').select('id, account_id').eq('id', userId).maybeSingle(),
      admin.from('memory_settings').select('user_id').eq('user_id', userId).maybeSingle(),
      admin.from('memory_privacy_consents').select('user_id, privacy_version').eq('user_id', userId).maybeSingle(),
    ]);
    const checkError = profileResult.error || settingsResult.error || consentResult.error;
    if (checkError) {
      console.error(JSON.stringify({
        event: 'registration_completion_check_failed',
        userId,
        message: checkError.message,
      }));
      return { complete: false, safeToRollback: false };
    }
    return {
      complete: profileResult.data?.account_id === normalizedAccount
        && settingsResult.data?.user_id === userId
        && consentResult.data?.user_id === userId
        && consentResult.data?.privacy_version === PRIVACY_NOTICE_VERSION,
      safeToRollback: true,
    };
  };
  const rollbackAuthUser = async (userId: string, requestNonce: string) => {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const initialization = await getInitializationStatus(userId);
      if (initialization.complete) return 'completed' as const;
      if (!initialization.safeToRollback) return 'unsafe' as const;

      const currentUser = await admin.auth.admin.getUserById(userId);
      if (!currentUser.data.user) {
        const message = currentUser.error?.message || '';
        if (!currentUser.error || /not found|does not exist/i.test(message)) return 'deleted' as const;
        lastError = message;
        if (attempt < 2) await wait(250 * (attempt + 1));
        continue;
      }
      const metadata = currentUser.data.user.app_metadata || {};
      if (metadata.registration_pending !== true || metadata.registration_nonce !== requestNonce) {
        return 'unsafe' as const;
      }

      const deletion = await admin.auth.admin.deleteUser(userId, false);
      const verification = await admin.auth.admin.getUserById(userId);
      const verificationMessage = verification.error?.message || '';
      const isConfirmedMissing = !verification.data.user && (
        !verification.error || /not found|does not exist/i.test(verificationMessage)
      );
      if (isConfirmedMissing) return 'deleted' as const;

      lastError = deletion.error?.message || verificationMessage || 'Auth user still exists.';
      if (attempt < 2) await wait(250 * (attempt + 1));
    }

    console.error(JSON.stringify({
      event: 'registration_rollback_failed',
      userId,
      message: lastError || 'Auth user still exists after rollback attempts.',
    }));
    return 'failed' as const;
  };
  const email = accountIdToAuthEmail(normalizedAccount);
  const name = getString(initialProfile.name);
  const avatarUrl = getString(initialProfile.avatarUrl);
  const initialStars = Array.isArray(initialState.stars)
    ? initialState.stars.filter(star => star && typeof star === 'object') as Record<string, unknown>[]
    : [];
  const defaultStar = initialStars[0];
  if (!defaultStar) {
    return json({ error: { code: 'setup_required', message: 'Could not create the default memory location.' } }, 500);
  }

  const requestNonce = crypto.randomUUID();
  const releaseClaim = async () => {
    const { error } = await admin.rpc('release_memory_registration_claim', {
      p_account_id: normalizedAccount,
      p_request_nonce: requestNonce,
    });
    if (error) {
      console.warn(JSON.stringify({
        event: 'registration_claim_release_failed',
        account: normalizedAccount,
        message: error.message,
      }));
    }
  };
  const { data: claimStatus, error: claimError } = await admin.rpc('claim_memory_registration', {
    p_account_id: normalizedAccount,
    p_request_nonce: requestNonce,
  });
  if (claimError) {
    console.error(JSON.stringify({
      event: 'registration_claim_failed',
      account: normalizedAccount,
      message: claimError.message,
    }));
    return json({ error: { code: 'setup_required', message: 'Registration integrity service is not configured.' } }, 500);
  }
  if (claimStatus === 'account_exists') {
    return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
  }
  if (claimStatus !== 'claimed') {
    return json({ error: { code: 'registration_in_progress', message: 'This account is already being registered.' } }, 409);
  }

  const verifyExistingAuthPassword = async (authUserId: string) => {
    const { data, error } = await passwordVerifier.auth.signInWithPassword({ email, password });
    const verified = !error && data.user?.id === authUserId;
    if (data.session) {
      const signOut = await passwordVerifier.auth.signOut({ scope: 'local' });
      if (signOut.error) {
        console.warn(JSON.stringify({
          event: 'registration_password_verification_session_cleanup_failed',
          userId: authUserId,
          message: signOut.error.message,
        }));
      }
    }
    return verified;
  };

  let authUser: Awaited<ReturnType<typeof findAuthUserByEmail>> = null;
  let createdByCurrentRequest = false;
  try {
    authUser = await findAuthUserByEmail(email);
  } catch (error) {
    await releaseClaim();
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
      await releaseClaim();
      return json({ error: { code: 'setup_required', message: 'Could not check incomplete account state.' } }, 500);
    }
    if (authProfile) {
      await releaseClaim();
      return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }

    if (!await verifyExistingAuthPassword(authUser.id)) {
      await releaseClaim();
      return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
    }
  } else {
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        account_id: normalizedAccount,
        name,
      },
      app_metadata: {
        registration_pending: true,
        registration_nonce: requestNonce,
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
        try {
          authUser = await findAuthUserByEmail(email);
        } catch (lookupError) {
          await releaseClaim();
          console.error(JSON.stringify({
            event: 'registration_duplicate_auth_lookup_failed',
            message: lookupError instanceof Error ? lookupError.message : String(lookupError),
          }));
          return json({ error: { code: 'setup_required', message: 'Could not verify the incomplete account.' } }, 500);
        }
        if (!authUser || !await verifyExistingAuthPassword(authUser.id)) {
          await releaseClaim();
          return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
        }
      } else {
        await releaseClaim();
        if (message.includes('password')) {
          return json({ error: { code: 'weak_password', message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` } }, 422);
        }
        return json({ error: { code: 'setup_required', message: 'Could not create account.' } }, 500);
      }
    } else {
      authUser = createdUser.user;
      createdByCurrentRequest = true;
    }
  }

  if (!authUser) {
    await releaseClaim();
    return json({ error: { code: 'setup_required', message: 'Could not resolve account authentication state.' } }, 500);
  }
  const userId = authUser.id;
  const { data: claimBound, error: bindError } = await admin.rpc('bind_memory_registration_claim', {
    p_account_id: normalizedAccount,
    p_request_nonce: requestNonce,
    p_user_id: userId,
  });
  if (bindError || claimBound !== true) {
    // The claim may already belong to another request. Leaving a nonce-marked
    // pending Auth user is safer than deleting a user another request may use.
    await releaseClaim();
    return json({ error: { code: 'registration_claim_lost', message: 'Registration ownership expired before initialization.' } }, 409);
  }

  const { error: initializeError } = await admin.rpc('initialize_claimed_memory_account', {
    p_request_nonce: requestNonce,
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
      profileMetadata: {
        timeZone: normalizeTimeZone(initialState.timeZone),
      },
    },
    p_default_star: defaultStar,
    p_privacy_version: PRIVACY_NOTICE_VERSION,
  });

  if (initializeError) {
    const initialization = await getInitializationStatus(userId);
    if (!initialization.complete) {
      if (createdByCurrentRequest) {
        const { data: rollbackClaimStatus, error: rollbackClaimError } = await admin.rpc('claim_memory_registration', {
          p_account_id: normalizedAccount,
          p_request_nonce: requestNonce,
        });
        if (rollbackClaimError || rollbackClaimStatus !== 'claimed') {
          await releaseClaim();
          return json({ error: { code: 'registration_rollback_failed', message: 'Account initialization failed and requires recovery.' } }, 500);
        }
        const rollbackStatus = await rollbackAuthUser(userId, requestNonce);
        await releaseClaim();
        if (rollbackStatus === 'failed' || rollbackStatus === 'unsafe') {
          return json({ error: { code: 'registration_rollback_failed', message: 'Account initialization failed and requires recovery.' } }, 500);
        }
      } else {
        await releaseClaim();
      }
      const message = initializeError.message.toLowerCase();
      if (message.includes('duplicate') || message.includes('unique')) {
        return json({ error: { code: 'account_exists', message: 'Account already exists.' } }, 409);
      }
      return json({ error: { code: 'setup_required', message: 'Could not initialize normalized memory storage.' } }, 500);
    }
    await releaseClaim();
  }

  const { error: finalizeMetadataError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...authUser.user_metadata,
      account_id: normalizedAccount,
      name,
      registration_pending: null,
    },
    app_metadata: {
      ...authUser.app_metadata,
      registration_pending: false,
      registration_nonce: null,
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
