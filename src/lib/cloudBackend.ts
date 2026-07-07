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

const requireSupabase = () => {
  if (!supabase) throw new Error('Cloud backend is not configured.');
  return supabase;
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

export const signInOrCreateCloudAccount = async ({
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
  let user = signInResult.data.user;
  let isNewAccount = false;

  if (signInResult.error || !user) {
    const signUpResult = await client.auth.signUp({
      email,
      password,
      options: {
        data: { account_id: normalizedAccount },
      },
    });

    if (signUpResult.error) throw signInResult.error || signUpResult.error;
    if (!signUpResult.data.session || !signUpResult.data.user) {
      throw new Error('Supabase email confirmation must be disabled for ID-only login.');
    }

    user = signUpResult.data.user;
    isNewAccount = true;
  }

  const cloudProfile = await ensureCloudProfile(user, {
    ...initialProfile,
    account: normalizedAccount,
  });

  const { state } = await loadCloudAccountData(user);
  if (!state) {
    await saveCloudAppState(initialState);
  }

  return {
    profile: cloudProfile,
    state: state || initialState,
    isNewAccount,
  };
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
    });

  if (error) throw error;
};

export const signOutCloudAccount = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

export { isCloudBackendEnabled };
