import { createClient, type Session } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

const isPlaceholderValue = (value?: string) => {
  if (!value) return true;
  const lowered = value.toLowerCase();
  const placeholders = ['your-', 'your_project', 'replace', 'example', 'dummy', 'changeme'];
  return placeholders.some(marker => lowered.includes(marker));
};

const isLikelySupabaseUrl = (url?: string) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const hasHttps = parsed.protocol === 'https:';
    const host = parsed.hostname || '';
    const isSupabaseHost = host.endsWith('.supabase.co');
    return hasHttps && isSupabaseHost && host.split('.').length >= 3;
  } catch {
    return false;
  }
};

const isLikelySupabaseAnonKey = (value?: string) => {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 30) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return false;
  return (trimmed.startsWith('eyJ') || trimmed.startsWith('sb_')) && !isPlaceholderValue(trimmed);
};

const getSupabaseProjectRef = (url?: string) => {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const hostParts = parsed.hostname.split('.');
    return hostParts.length >= 3 ? hostParts[0] : '';
  } catch {
    return '';
  }
};

export const supabaseProjectRef = getSupabaseProjectRef(supabaseUrl);
export const supabasePublishableKey = supabaseAnonKey || '';

export const isSupabaseConfigValid =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  isLikelySupabaseUrl(supabaseUrl) &&
  isLikelySupabaseAnonKey(supabaseAnonKey) &&
  !isPlaceholderValue(supabaseUrl) &&
  !isPlaceholderValue(supabaseAnonKey);

export const supabaseConfigMessage = isSupabaseConfigValid
  ? ''
  : !supabaseUrl || !supabaseAnonKey
    ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.'
    : isPlaceholderValue(supabaseUrl) || isPlaceholderValue(supabaseAnonKey)
      ? 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY still contain example placeholder values.'
      : !isLikelySupabaseUrl(supabaseUrl)
        ? 'VITE_SUPABASE_URL is not a valid https://*.supabase.co URL.'
        : !isLikelySupabaseAnonKey(supabaseAnonKey)
          ? 'VITE_SUPABASE_ANON_KEY is not a valid Supabase publishable anon key.'
          : 'Supabase config is invalid.';

export const isCloudBackendEnabled = isSupabaseConfigValid;

export const supabaseFunctionUrl = (functionName: string) => (
  isCloudBackendEnabled && supabaseUrl
    ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/${functionName}`
    : ''
);

export const supabase = isCloudBackendEnabled
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export type CloudSession = Session;
