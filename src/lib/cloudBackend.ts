import type { User } from '@supabase/supabase-js';
import {
  isCloudBackendEnabled,
  supabase,
  supabaseFunctionUrl,
  supabaseProjectRef,
  supabasePublishableKey,
  type CloudSession,
} from './supabaseClient';
import { sanitizeRichHtmlFields } from './htmlSanitizer';
import { normalizePersistedAppState } from './appStateNormalize';
import { normalizeAccountId } from './accountUtils';
import { loadNormalizedMemoryAccountData } from './memoryRepository';
import { CLOUD_PASSWORD_MIN_LENGTH, PRIVACY_NOTICE_VERSION } from '../constants/appDefaults';

export type CloudProfile = {
  account: string;
  name: string;
  avatarUrl: string;
};

export type CloudAppState = Record<string, unknown>;

export type CloudMcpTokenInfo = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CloudAuthErrorDetails = {
  phase: 'signup' | 'signin' | 'set_session' | 'profile_save' | 'state_save' | 'state_load' | 'setup';
  email?: string;
  accountId?: string;
  userId?: string;
  tokenRef?: string;
  tokenRole?: string;
  clientProjectRef?: string;
  tokenProjectRefMatch?: boolean;
  hasUser?: boolean;
  hasSession?: boolean;
  rawCode?: string;
  rawStatus?: string;
  rawName?: string;
  rawDetails?: string;
  rawHint?: string;
  rawMessage?: string;
  message?: string;
  raw?: unknown;
};

export type CloudAccountData = {
  profile: CloudProfile;
  state: CloudAppState | null;
  revision: number;
  revisionSupported: boolean;
  dataModelVersion?: number;
};

const SENSITIVE_CLOUD_STATE_KEYS = new Set([
  'password',
  'loginpassword',
  'registerpassword',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'passwordconfirmation',
  'registerconfirmpassword',
  'invitecode',
]);

export type CloudAuthAction = 'login' | 'register';

export class CloudAuthError extends Error {
  code: 'invalid_credentials' | 'account_exists' | 'setup_required' | 'registration_disabled' | 'registration_in_progress' | 'invite_required' | 'weak_password' | 'password_mismatch' | 'privacy_consent_required' | 'unknown';
  details?: CloudAuthErrorDetails;

  constructor(code: CloudAuthError['code'], message: string, details?: CloudAuthErrorDetails) {
    super(message);
    this.name = 'CloudAuthError';
    this.code = code;
    this.details = details;
  }
}

export class CloudAccountDeletionError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'CloudAccountDeletionError';
    this.code = code;
    this.status = status;
  }
}

const requireSupabase = () => {
  if (!supabase) throw new Error('Cloud backend is not configured.');
  return supabase;
};

const activateCloudSession = async (session: CloudSession | null, expectedUserId?: string) => {
  const client = requireSupabase();
  if (!session?.access_token || !session.refresh_token) {
    throw new CloudAuthError('registration_disabled', 'A login session was not returned by Supabase.');
  }

  const tokenProjectRef = getTokenProjectRef(session.access_token);
  const clientProjectRef = supabaseProjectRef;
  if (tokenProjectRef && clientProjectRef && tokenProjectRef !== clientProjectRef) {
    throw new CloudAuthError('setup_required', 'The returned auth token belongs to a different Supabase project.', {
      phase: 'set_session',
      tokenRef: tokenProjectRef,
      clientProjectRef,
      tokenProjectRefMatch: false,
      userId: expectedUserId,
      hasUser: true,
      hasSession: true,
      message: `Token project ${tokenProjectRef} does not match config project ${clientProjectRef}`,
    });
  }

  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  if (error) throw error;

  if (expectedUserId) {
    const { data: activeUser, error: activeError } = await client.auth.getUser();
    if (activeError || !activeUser.user || activeUser.user.id !== expectedUserId) {
      throw new CloudAuthError('setup_required', 'Cloud session did not attach to authenticated request.', {
        phase: 'set_session',
        tokenRef: tokenProjectRef,
        clientProjectRef,
        tokenProjectRefMatch: tokenProjectRef ? tokenProjectRef === clientProjectRef : undefined,
        userId: expectedUserId,
        hasUser: Boolean(activeUser.user),
        hasSession: true,
        message: activeError?.message || 'Auth session user mismatch',
        raw: activeError,
      });
    }
  }
};

export const accountIdToAuthEmail = (accountId: string) => {
  const normalized = normalizeAccountId(accountId);
  const bytes = new TextEncoder().encode(normalized);
  const hex = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `u_${hex}@accounts.my-life-memory.app`;
};

const sanitizeCloudValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeCloudValue(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (SENSITIVE_CLOUD_STATE_KEYS.has(key.toLowerCase())) return;
    sanitized[key] = sanitizeCloudValue(entry);
  });
  return sanitized;
};

const sanitizeCloudAppState = (state: CloudAppState | null): CloudAppState | null => (
  state ? normalizePersistedAppState(sanitizeRichHtmlFields(sanitizeCloudValue(state) as CloudAppState)) : null
);

const isCloudSetupError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: string }).code : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  const details = 'details' in error ? String((error as { details?: unknown }).details || '') : '';
  const hint = 'hint' in error ? String((error as { hint?: unknown }).hint || '') : '';
  const status = 'status' in error ? String((error as { status?: unknown }).status || '') : '';
  const text = `${String(code)} ${message} ${details} ${hint}`.toLowerCase();

  return (
    code === 'PGRST205' ||
    code === '42501' ||
    code === '42P01' ||
    code === '42P02' ||
    code === 'PGRST116' ||
    status === '403' ||
    status === '401' ||
    text.includes('permission denied') ||
    text.includes('policy') ||
    text.includes('rls') ||
    text.includes('relation \"public.') ||
    text.includes('relation \"profiles\"') ||
    text.includes('relation \"app_states\"') ||
    text.includes('table \"profiles\"') ||
    text.includes('table \"app_states\"')
  );
};

const isNetworkError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;

  const name = 'name' in error ? String((error as { name?: unknown }).name || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : null;
  const causeMessage =
    cause && typeof cause === 'object' && 'message' in cause
      ? String((cause as { message?: unknown }).message || '')
      : '';

  const text = `${name} ${message} ${causeMessage}`.toLowerCase();
  return (
    text.includes('fetch failed') ||
    text.includes('failed to fetch') ||
    text.includes('network error') ||
    text.includes('econnreset') ||
    text.includes('enotfound') ||
    text.includes('timeout') ||
    text.includes('server returned error') ||
    text.includes('undici')
  );
};
const getAuthErrorText = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  return `${code} ${message}`.toLowerCase();
};

const isWeakPasswordError = (error: unknown) => {
  const text = getAuthErrorText(error);
  return text.includes('weak_password') || (text.includes('password') && text.includes('6'));
};

const getJwtPayload = (jwt: string) => {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [headerPayload] = parts.slice(1, 2);
  try {
    const normalized = headerPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getTokenProjectRef = (jwt: string) => {
  const payload = getJwtPayload(jwt);
  const iss = typeof payload?.iss === 'string' ? payload.iss : '';
  if (!iss) return '';
  const match = iss.match(/^https:\/\/([^\.]+)\.supabase\.co/);
  return match ? match[1] : iss;
};

const isExistingAccountError = (error: unknown) => {
  const text = getAuthErrorText(error);
  return (
    text.includes('already registered') ||
    text.includes('already exists') ||
    text.includes('duplicate key') ||
    text.includes('unique constraint') ||
    text.includes('user_already_exists') ||
    text.includes('email_exists')
  );
};

const toCloudAuthError = (error: unknown, fallback: CloudAuthError['code'] = 'unknown', details?: CloudAuthErrorDetails) => {
  if (error instanceof CloudAuthError) return error;
  const meta = extractSupabaseErrorMeta(error);
  const payloadMessage = extractSupabaseErrorText(error) || (error instanceof Error ? error.message : '');
  const normalized = error instanceof Error
    ? {
        ...details,
        ...meta,
        message: payloadMessage,
        raw: error,
      }
    : { ...details, ...meta, message: payloadMessage, raw: error };

  if (isEmailConfirmationError(error)) {
    return new CloudAuthError('registration_disabled', 'This account is waiting for email confirmation.', {
      ...normalized,
      phase: normalized?.phase || 'signin',
      message: payloadMessage || 'Email confirmation is required.',
    });
  }
  if (isCloudSetupError(error)) {
    return new CloudAuthError('setup_required', 'Supabase database setup is incomplete.', {
      ...normalized,
      phase: details?.phase || 'setup',
      message: payloadMessage || 'Supabase database setup is incomplete.',
    });
  }
  if (isNetworkError(error)) {
    return new CloudAuthError('setup_required', 'Unable to reach Supabase project. Check VITE_SUPABASE_URL, key, and network access.', {
      ...normalized,
      phase: details?.phase || 'setup',
      message: payloadMessage || 'Unable to reach Supabase project.',
    });
  }
  if (isWeakPasswordError(error)) {
    return new CloudAuthError('weak_password', 'Password is too short.', {
      ...normalized,
      phase: details?.phase || 'setup',
      message: payloadMessage || 'Password is too short.',
    });
  }
  if (isExistingAccountError(error)) {
    return new CloudAuthError('account_exists', 'Account already exists.', {
      ...normalized,
      phase: details?.phase || 'signup',
      message: payloadMessage || 'Account already exists.',
    });
  }
  return new CloudAuthError(fallback, error instanceof Error ? error.message : 'Cloud auth failed.', {
    ...normalized,
    message: payloadMessage || 'Cloud auth failed.',
  });
};

export const getCloudSession = async (): Promise<CloudSession | null> => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export const onCloudAuthStateChange = (callback: (session: CloudSession | null) => void) => {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
};

export const loadCloudAccountData = async (user: User): Promise<CloudAccountData> => {
  try {
    const normalized = await loadNormalizedMemoryAccountData(user);
    return {
      profile: normalized.profile,
      state: sanitizeCloudAppState(normalized.state),
      revision: normalized.revision,
      revisionSupported: true,
      dataModelVersion: normalized.dataModelVersion,
    };
  } catch (error) {
    throw toCloudAuthError(error, 'setup_required', {
      phase: 'state_load',
      userId: user.id,
      accountId: inferAccountFromAuthUser(user),
      email: user.email,
      ...extractSupabaseErrorMeta(error),
      message: extractSupabaseErrorText(error) || (error instanceof Error ? error.message : ''),
    });
  }
};

const isEmailConfirmationError = (error: unknown) => {
  const text = getAuthErrorText(error);
  return text.includes('email_not_confirmed') || text.includes('email confirmation') || text.includes('email not confirmed');
};

const coerceString = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
};

const getErrorProp = (error: unknown, key: string) =>
  !error || typeof error !== 'object' ? '' : key in error ? (error as Record<string, unknown>)[key] : '';

const extractSupabaseErrorText = (error: unknown) => {
  if (!error || typeof error !== 'object') return '';
  const message = coerceString(getErrorProp(error, 'message'));
  const details = coerceString(getErrorProp(error, 'details'));
  const hint = coerceString(getErrorProp(error, 'hint'));
  return `${message} ${details} ${hint}`.trim();
};

const extractSupabaseErrorMeta = (error: unknown) => ({
  rawCode: coerceString(getErrorProp(error, 'code')),
  rawStatus: coerceString(getErrorProp(error, 'status')),
  rawName: coerceString(getErrorProp(error, 'name')),
  rawDetails: coerceString(getErrorProp(error, 'details')),
  rawHint: coerceString(getErrorProp(error, 'hint')),
  rawMessage: coerceString(getErrorProp(error, 'message')),
});

const inferAccountFromAuthUser = (user: User, fallback = '') => {
  const metadataAccount = typeof user.user_metadata?.account_id === 'string' ? user.user_metadata.account_id : '';
  if (metadataAccount && metadataAccount.trim()) return normalizeAccountId(metadataAccount);

  const emailPrefix = user.email ? user.email.split('@')[0] || '' : '';
  if (!emailPrefix) return fallback;
  if (emailPrefix.startsWith('u_')) {
    const hex = emailPrefix.slice(2);
    if (hex.length % 2 === 0) {
      try {
        const bytes = hex.match(/.{2}/g);
        if (!bytes) return '';
        const decoded = bytes
          .map(part => Number.parseInt(part, 16))
          .filter(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)
          .map(byte => String.fromCharCode(byte))
          .join('');
        const normalized = normalizeAccountId(decoded);
        if (normalized) return normalized;
      } catch {
        // fallback to prefix form
      }
    }
    return '';
  }

  return normalizeAccountId(emailPrefix);
};

const buildInitialCloudData = ({
  account,
  initialProfile,
  initialState,
}: {
  account: string;
  initialProfile: CloudProfile;
  initialState: CloudAppState;
}) => ({
  profile: {
    ...initialProfile,
    account,
  },
  state: initialState,
});

const readFunctionErrorPayload = async (error: unknown) => {
  const response = error && typeof error === 'object' && 'context' in error
    ? (error as { context?: unknown }).context
    : null;
  const status = response && typeof response === 'object' && 'status' in response
    ? Number((response as { status?: unknown }).status)
    : undefined;
  let payload: Record<string, unknown> | null = null;

  if (response instanceof Response) {
    try {
      payload = await response.clone().json() as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }

  const bodyError = payload && typeof payload.error === 'object' && payload.error
    ? payload.error as Record<string, unknown>
    : payload;

  return {
    status,
    code: typeof bodyError?.code === 'string' ? bodyError.code : '',
    message: typeof bodyError?.message === 'string' ? bodyError.message : '',
    payload,
  };
};

export const loginCloudAccount = async ({
  account,
  password,
}: {
  account: string;
  password: string;
}) => {
  const client = requireSupabase();
  const clientProjectRef = supabaseProjectRef;
  const normalizedAccount = normalizeAccountId(account);
  if (!normalizedAccount || !password) throw new Error('Account and password are required.');

  const email = accountIdToAuthEmail(normalizedAccount);
  const signInResult = await client.auth.signInWithPassword({ email, password });
  if (import.meta.env.DEV) {
    console.debug('[My life memory] signIn result', {
      email,
      hasUser: Boolean(signInResult.data.user),
      hasSession: Boolean(signInResult.data.session),
      error: signInResult.error,
    });
  }
  const user = signInResult.data.user;

  if (signInResult.error || !user) {
    if (!signInResult.error && !user) {
      throw new CloudAuthError('invalid_credentials', 'Invalid account or password.', {
        phase: 'signin',
        email,
        accountId: normalizedAccount,
        userId: undefined,
        tokenRef: signInResult.data.session ? getTokenProjectRef(signInResult.data.session.access_token) : '',
        clientProjectRef,
        tokenProjectRefMatch: signInResult.data.session
          ? getTokenProjectRef(signInResult.data.session.access_token) === clientProjectRef
          : undefined,
        tokenRole: signInResult.data.session?.user?.role,
        hasUser: Boolean(signInResult.data.user),
        hasSession: Boolean(signInResult.data.session),
      });
    }

    throw toCloudAuthError(signInResult.error, 'invalid_credentials', {
      phase: 'signin',
      email,
      accountId: normalizedAccount,
      userId: signInResult.data.user?.id,
      tokenRef: signInResult.data.session ? getTokenProjectRef(signInResult.data.session.access_token) : '',
      clientProjectRef,
      tokenProjectRefMatch: signInResult.data.session
        ? getTokenProjectRef(signInResult.data.session.access_token) === clientProjectRef
        : undefined,
      tokenRole: signInResult.data.session?.user?.role,
      hasUser: Boolean(signInResult.data.user),
      hasSession: Boolean(signInResult.data.session),
      raw: signInResult.error,
      message: signInResult.error?.message,
      ...extractSupabaseErrorMeta(signInResult.error),
    });
  }
  await activateCloudSession(signInResult.data.session, user.id);

  try {
    const { profile: cloudProfile, state, revision, revisionSupported } = await loadCloudAccountData(user);

    return {
      profile: cloudProfile,
      state,
      revision,
      revisionSupported,
      isNewAccount: false,
    };
  } catch (error) {
    throw toCloudAuthError(error, 'unknown', {
      phase: 'state_load',
      accountId: normalizedAccount,
      email,
      userId: user.id,
      clientProjectRef,
      tokenRef: signInResult.data.session ? getTokenProjectRef(signInResult.data.session.access_token) : '',
      tokenProjectRefMatch: signInResult.data.session
        ? getTokenProjectRef(signInResult.data.session.access_token) === clientProjectRef
        : undefined,
      hasUser: true,
      hasSession: Boolean(signInResult.data.session),
    });
  }
};

export const registerCloudAccount = async ({
  account,
  password,
  passwordConfirmation,
  inviteCode,
  privacyAccepted,
  initialProfile,
  initialState,
}: {
  account: string;
  password: string;
  passwordConfirmation: string;
  inviteCode: string;
  privacyAccepted: boolean;
  initialProfile: CloudProfile;
  initialState: CloudAppState;
}) => {
  const client = requireSupabase();
  const normalizedAccount = normalizeAccountId(account);
  if (!normalizedAccount || !password) throw new Error('Account and password are required.');
  if (password.length < CLOUD_PASSWORD_MIN_LENGTH) throw new CloudAuthError('weak_password', 'Password is too short.');
  if (password !== passwordConfirmation) throw new CloudAuthError('password_mismatch', 'Password confirmation does not match.');
  if (!inviteCode.trim()) throw new CloudAuthError('invite_required', 'Invite code is required.');
  if (!privacyAccepted) throw new CloudAuthError('privacy_consent_required', 'Privacy consent is required.');

  const email = accountIdToAuthEmail(normalizedAccount);
  const registerDebug = {
    phase: 'signup' as const,
    accountId: normalizedAccount,
    email,
  };

  try {
    const initialData = buildInitialCloudData({
      account: normalizedAccount,
      initialProfile,
      initialState,
    });
    const { data, error } = await client.functions.invoke('register-with-invite', {
      body: {
        account: normalizedAccount,
        password,
        passwordConfirmation,
        inviteCode,
        privacyAccepted,
        privacyVersion: PRIVACY_NOTICE_VERSION,
        initialProfile: initialData.profile,
        initialState: initialData.state,
      },
    });

    if (error) {
      const functionError = await readFunctionErrorPayload(error);
      const details = {
        ...registerDebug,
        rawStatus: functionError.status ? String(functionError.status) : '',
        rawCode: functionError.code,
        rawMessage: functionError.message,
        raw: functionError.payload || error,
        message: functionError.message || extractSupabaseErrorText(error),
      };

      if (functionError.status === 403 || functionError.code === 'invalid_invite') {
        throw new CloudAuthError('invite_required', 'Invite code is invalid.', details);
      }
      if (functionError.code === 'registration_in_progress' || functionError.code === 'registration_claim_lost') {
        throw new CloudAuthError('registration_in_progress', 'Registration is already in progress.', details);
      }
      if (functionError.status === 409 || functionError.code === 'account_exists') {
        throw new CloudAuthError('account_exists', 'Account already exists.', details);
      }
      if (functionError.status === 422 || functionError.code === 'weak_password') {
        if (functionError.code === 'password_mismatch') {
          throw new CloudAuthError('password_mismatch', 'Password confirmation does not match.', details);
        }
        if (functionError.code === 'privacy_consent_required') {
          throw new CloudAuthError('privacy_consent_required', 'Privacy consent is required.', details);
        }
        throw new CloudAuthError('weak_password', 'Password is too short.', details);
      }

      throw toCloudAuthError(error, 'unknown', details);
    }

    if (import.meta.env.DEV) {
      console.debug('[My life memory] register-with-invite result', {
        ...registerDebug,
        ok: Boolean((data as { ok?: unknown } | null)?.ok),
      });
    }

    if (!(data as { ok?: unknown } | null)?.ok) {
      throw new CloudAuthError('unknown', 'Registration failed.', registerDebug);
    }

    return {
      profile: initialData.profile,
      state: initialData.state,
      isNewAccount: true,
    };
  } catch (error) {
    throw toCloudAuthError(error, 'unknown', {
      ...registerDebug,
      message: error instanceof Error ? error.message : '',
      raw: error,
      ...extractSupabaseErrorMeta(error),
    });
  }
};

export const signInOrCreateCloudAccount = async (params: Parameters<typeof registerCloudAccount>[0]) => {
  try {
    return await loginCloudAccount(params);
  } catch (error) {
    const authError = toCloudAuthError(error, 'invalid_credentials');
    if (authError.code !== 'invalid_credentials') throw authError;
    return registerCloudAccount(params);
  }
};

const readCloudFunctionResponse = async <T>(response: Response): Promise<T> => {
  const text = await response.text();
  let payload: (T & { error?: { message?: string; code?: string } }) | null = null;
  try {
    payload = text ? JSON.parse(text) as T & { error?: { message?: string; code?: string } } : null;
  } catch {
    payload = null;
  }
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message || `Cloud function failed with HTTP ${response.status}`);
  }
  return payload as T;
};

const callMcpTokenFunction = async <T>(body: Record<string, unknown>) => {
  const client = requireSupabase();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('No active cloud session.');

  const endpoint = supabaseFunctionUrl('mcp-token');
  if (!endpoint) throw new Error('Cloud backend is not configured.');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return readCloudFunctionResponse<T>(response);
};

export const getCloudMcpEndpoint = () => supabaseFunctionUrl('mcp');

export const listCloudMcpTokens = async () => {
  const payload = await callMcpTokenFunction<{ ok: true; tokens: CloudMcpTokenInfo[] }>({ action: 'list' });
  return payload.tokens || [];
};

export const createCloudMcpToken = async (name = 'My Life Memory MCP') => {
  return callMcpTokenFunction<{ ok: true; token: string; tokenInfo: CloudMcpTokenInfo }>({
    action: 'create',
    name,
  });
};

export const revokeCloudMcpToken = async (tokenId: string) => {
  return callMcpTokenFunction<{ ok: true }>({
    action: 'revoke',
    tokenId,
  });
};

export const deleteCloudAccount = async (password: string) => {
  const client = requireSupabase();
  if (!password) {
    throw new CloudAccountDeletionError('password_required', 'Current password is required.', 400);
  }

  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) {
    throw new CloudAccountDeletionError('unauthorized', 'No active cloud session.', 401);
  }

  const endpoint = supabaseFunctionUrl('delete-account');
  if (!endpoint) {
    throw new CloudAccountDeletionError('setup_required', 'Cloud backend is not configured.', 500);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });
  const text = await response.text();
  let payload: {
    ok?: boolean;
    userId?: string;
    removedMediaCount?: number;
    error?: { code?: string; message?: string };
  } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok || !payload.userId) {
    throw new CloudAccountDeletionError(
      payload?.error?.code || 'delete_failed',
      payload?.error?.message || `Account deletion failed with HTTP ${response.status}`,
      response.status,
    );
  }

  return {
    userId: payload.userId,
    removedMediaCount: Math.max(0, Number(payload.removedMediaCount) || 0),
  };
};

export const updateCloudPassword = async ({
  account,
  currentPassword,
  newPassword,
}: {
  account: string;
  currentPassword: string;
  newPassword: string;
}) => {
  const client = requireSupabase();
  const normalizedAccount = normalizeAccountId(account);
  if (!normalizedAccount || !currentPassword || !newPassword) {
    throw new CloudAuthError('invalid_credentials', 'Account and password are required.');
  }
  if (newPassword.length < CLOUD_PASSWORD_MIN_LENGTH) {
    throw new CloudAuthError('weak_password', 'Password is too short.');
  }

  const email = accountIdToAuthEmail(normalizedAccount);
  const signInResult = await client.auth.signInWithPassword({ email, password: currentPassword });
  if (signInResult.error || !signInResult.data.user) {
    throw toCloudAuthError(signInResult.error, 'invalid_credentials', {
      phase: 'signin',
      email,
      accountId: normalizedAccount,
      message: signInResult.error?.message,
      raw: signInResult.error,
      ...extractSupabaseErrorMeta(signInResult.error),
    });
  }

  await activateCloudSession(signInResult.data.session, signInResult.data.user.id);

  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) {
    throw toCloudAuthError(error, 'unknown', {
      phase: 'signin',
      email,
      accountId: normalizedAccount,
      userId: signInResult.data.user.id,
      message: error.message,
      raw: error,
      ...extractSupabaseErrorMeta(error),
    });
  }
};

export const signOutCloudAccount = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

export { isCloudBackendEnabled };
