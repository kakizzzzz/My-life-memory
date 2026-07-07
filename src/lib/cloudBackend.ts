import type { User } from '@supabase/supabase-js';
import { isCloudBackendEnabled, supabase, type CloudSession } from './supabaseClient';

export type CloudProfile = {
  account: string;
  name: string;
  avatarUrl: string;
};

export type CloudAppState = Record<string, unknown>;

type ProfileRow = {
  account_id: string;
  name: string | null;
  avatar_url: string | null;
};

type AppStateRow = {
  state: CloudAppState | null;
};

export type CloudAuthAction = 'login' | 'register';

export class CloudAuthError extends Error {
  code: 'invalid_credentials' | 'account_exists' | 'setup_required' | 'registration_disabled' | 'weak_password' | 'unknown';

  constructor(code: CloudAuthError['code'], message: string) {
    super(message);
    this.name = 'CloudAuthError';
    this.code = code;
  }
}

const requireSupabase = () => {
  if (!supabase) throw new Error('Cloud backend is not configured.');
  return supabase;
};

const activateCloudSession = async (session: CloudSession | null) => {
  const client = requireSupabase();
  if (!session?.access_token || !session.refresh_token) {
    throw new CloudAuthError('registration_disabled', 'A login session was not returned by Supabase.');
  }

  const { error } = await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  if (error) throw error;
};

export const normalizeAccountId = (accountId: string) => accountId.trim().toLowerCase();

export const accountIdToAuthEmail = (accountId: string) => {
  const normalized = normalizeAccountId(accountId);
  const bytes = new TextEncoder().encode(normalized);
  const hex = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `u_${hex}@accounts.my-life-memory.app`;
};

const rowToProfile = (row: ProfileRow, fallbackAccount = ''): CloudProfile => ({
  account: row.account_id || fallbackAccount,
  name: row.name || '',
  avatarUrl: row.avatar_url || '',
});

const isCloudSetupError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: string }).code : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';

  return code === 'PGRST205' || code === '42501' || message.toLowerCase().includes('permission denied');
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

const toCloudAuthError = (error: unknown, fallback: CloudAuthError['code'] = 'unknown') => {
  if (error instanceof CloudAuthError) return error;
  if (isCloudSetupError(error)) {
    return new CloudAuthError('setup_required', 'Supabase database setup is incomplete.');
  }
  if (isWeakPasswordError(error)) {
    return new CloudAuthError('weak_password', 'Password is too short.');
  }
  if (isExistingAccountError(error)) {
    return new CloudAuthError('account_exists', 'Account already exists.');
  }
  return new CloudAuthError(fallback, error instanceof Error ? error.message : 'Cloud auth failed.');
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

export const loadCloudAccountData = async (user: User): Promise<{ profile: CloudProfile; state: CloudAppState | null }> => {
  const client = requireSupabase();

  const [{ data: profileRow, error: profileError }, { data: stateRow, error: stateError }] = await Promise.all([
    client
      .from('profiles')
      .select('account_id,name,avatar_url')
      .eq('id', user.id)
      .maybeSingle<ProfileRow>(),
    client
      .from('app_states')
      .select('state')
      .eq('user_id', user.id)
      .maybeSingle<AppStateRow>(),
  ]);

  if (profileError) throw profileError;
  if (stateError) throw stateError;

  const metadataAccount = typeof user.user_metadata?.account_id === 'string' ? user.user_metadata.account_id : '';
  const profile = profileRow
    ? rowToProfile(profileRow, metadataAccount)
    : { account: metadataAccount, name: '', avatarUrl: '' };

  return {
    profile,
    state: stateRow?.state || null,
  };
};

const ensureCloudProfile = async (user: User, profile: CloudProfile) => {
  const client = requireSupabase();
  const account = normalizeAccountId(profile.account || user.user_metadata?.account_id || '');
  if (!account) throw new Error('Account ID is required.');

  const { data: existing, error: readError } = await client
    .from('profiles')
    .select('account_id,name,avatar_url')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (readError) throw readError;

  if (existing) {
    return rowToProfile(existing, account);
  }

  const { data, error } = await client
    .from('profiles')
    .insert({
      id: user.id,
      account_id: account,
      name: profile.name || '',
      avatar_url: profile.avatarUrl || '',
    })
    .select('account_id,name,avatar_url')
    .single<ProfileRow>();

  if (error) throw error;
  return rowToProfile(data, account);
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

export const loginCloudAccount = async ({
  account,
  password,
  initialProfile,
  initialState,
}: {
  account: string;
  password: string;
  initialProfile: CloudProfile;
  initialState: CloudAppState;
}) => {
  const client = requireSupabase();
  const normalizedAccount = normalizeAccountId(account);
  if (!normalizedAccount || !password) throw new Error('Account and password are required.');

  const email = accountIdToAuthEmail(normalizedAccount);
  const signInResult = await client.auth.signInWithPassword({ email, password });
  const user = signInResult.data.user;

  if (signInResult.error || !user) {
    throw new CloudAuthError('invalid_credentials', 'Invalid account or password.');
  }
  await activateCloudSession(signInResult.data.session);

  try {
    const initialData = buildInitialCloudData({
      account: normalizedAccount,
      initialProfile,
      initialState,
    });
    const cloudProfile = await ensureCloudProfile(user, initialData.profile);
    const { state } = await loadCloudAccountData(user);
    if (!state) {
      await saveCloudAppState(initialData.state);
    }

    return {
      profile: cloudProfile,
      state: state || initialData.state,
      isNewAccount: false,
    };
  } catch (error) {
    throw toCloudAuthError(error);
  }
};

export const registerCloudAccount = async ({
  account,
  password,
  initialProfile,
  initialState,
}: {
  account: string;
  password: string;
  initialProfile: CloudProfile;
  initialState: CloudAppState;
}) => {
  const client = requireSupabase();
  const normalizedAccount = normalizeAccountId(account);
  if (!normalizedAccount || !password) throw new Error('Account and password are required.');
  if (password.length < 6) throw new CloudAuthError('weak_password', 'Password is too short.');

  const email = accountIdToAuthEmail(normalizedAccount);

  try {
    const signUpResult = await client.auth.signUp({
      email,
      password,
      options: {
        data: { account_id: normalizedAccount },
      },
    });

    if (signUpResult.error) throw signUpResult.error;
    if (Array.isArray(signUpResult.data.user?.identities) && signUpResult.data.user.identities.length === 0) {
      throw new CloudAuthError('account_exists', 'Account already exists.');
    }
    if (!signUpResult.data.session || !signUpResult.data.user) {
      throw new CloudAuthError('registration_disabled', 'Supabase email confirmation must be disabled for ID-only login.');
    }
    await activateCloudSession(signUpResult.data.session);

    const initialData = buildInitialCloudData({
      account: normalizedAccount,
      initialProfile,
      initialState,
    });
    const cloudProfile = await ensureCloudProfile(signUpResult.data.user, initialData.profile);
    await saveCloudAppState(initialData.state);
    await client.auth.signOut();

    return {
      profile: cloudProfile,
      state: initialData.state,
      isNewAccount: true,
    };
  } catch (error) {
    await client.auth.signOut().catch(() => {});
    throw toCloudAuthError(error);
  }
};

export const signInOrCreateCloudAccount = async (params: Parameters<typeof loginCloudAccount>[0]) => {
  try {
    return await loginCloudAccount(params);
  } catch (error) {
    const authError = toCloudAuthError(error, 'invalid_credentials');
    if (authError.code !== 'invalid_credentials') throw authError;
    return registerCloudAccount(params);
  }
};

export const saveCloudProfile = async (profile: CloudProfile) => {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error('No active cloud session.');

  const { error } = await client
    .from('profiles')
    .update({
      name: profile.name || '',
      avatar_url: profile.avatarUrl || '',
    })
    .eq('id', user.id);

  if (error) throw error;
};

export const saveCloudAppState = async (state: CloudAppState) => {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error('No active cloud session.');

  const { error } = await client
    .from('app_states')
    .upsert({
      user_id: user.id,
      state,
    }, { onConflict: 'user_id' });

  if (error) throw error;
};

export const signOutCloudAccount = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

export { isCloudBackendEnabled };
