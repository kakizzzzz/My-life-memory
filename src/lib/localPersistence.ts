import { LANGUAGE_OPTIONS } from '../constants/language';
import {
  APP_STORAGE_KEY,
  AUTO_USER_MANUAL_KEY_PREFIX,
  TRACK_DRAFT_STORAGE_KEY_PREFIX,
} from '../constants/storageKeys';
import type { MapStyle, PersistedAppState, TrackDraftData, UserProfile } from '../types/app';
import { sanitizeRichHtmlFields } from './htmlSanitizer';
import { normalizePersistedAppState } from './appStateNormalize';
import { storagePlaceholderSrc } from './mediaStorage';
import { normalizeAccountId } from './accountUtils';

export const isMapStyle = (value: unknown): value is MapStyle => (
  value === 'light' || value === 'dark' || value === 'aerial'
);

export const isLanguage = (value: unknown): value is 'en' | 'zh' | 'ko' => (
  typeof value === 'string' && LANGUAGE_OPTIONS.some(option => option.value === value)
);

export const hasLoginAccount = (profile: UserProfile) => (
  profile.account.trim().length > 0
);

export const getPersistableAvatarUrl = (profile?: Partial<UserProfile>) => (
  profile?.avatarImage ? storagePlaceholderSrc(profile.avatarImage) : profile?.avatarUrl || ''
);

export const readPersistedAppState = (): PersistedAppState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? normalizePersistedAppState(sanitizeRichHtmlFields(parsed as PersistedAppState))
      : null;
  } catch {
    return null;
  }
};

const getAutoUserManualStorageKey = (account: string) => (
  `${AUTO_USER_MANUAL_KEY_PREFIX}${normalizeAccountId(account) || 'local'}`
);

export const readAutoUserManualSeen = (account: string) => {
  if (typeof window === 'undefined') return true;

  try {
    return window.localStorage.getItem(getAutoUserManualStorageKey(account)) === 'seen';
  } catch {
    return true;
  }
};

export const markAutoUserManualSeen = (account: string) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getAutoUserManualStorageKey(account), 'seen');
  } catch {
    // Manual auto-open is a convenience; storage failures should not block login.
  }
};

export const getPublicProfileSnapshot = (profile?: Partial<UserProfile>): Partial<UserProfile> => ({
  name: profile?.name || '',
  account: profile?.account || '',
  avatarUrl: getPersistableAvatarUrl(profile),
  avatarImage: profile?.avatarImage,
});

export const writePersistedAppState = (state: PersistedAppState) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(normalizePersistedAppState(sanitizeRichHtmlFields(state))));
  } catch {
    // Storage can fail when image-heavy notes exceed the browser quota.
  }
};

const getTrackDraftStorageKey = (account: string) => (
  `${TRACK_DRAFT_STORAGE_KEY_PREFIX}${normalizeAccountId(account) || 'local'}`
);

const isValidTrackDraftPoint = (value: unknown): value is [number, number] => (
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(Number(value[0])) &&
  Number.isFinite(Number(value[1])) &&
  Number(value[0]) >= -90 &&
  Number(value[0]) <= 90 &&
  Number(value[1]) >= -180 &&
  Number(value[1]) <= 180
);

const normalizeTrackDraftPaths = (value: unknown): [number, number][][] => (
  Array.isArray(value)
    ? value
        .map(segment => (
          Array.isArray(segment)
            ? segment
                .map(point => isValidTrackDraftPoint(point) ? [Number(point[0]), Number(point[1])] as [number, number] : null)
                .filter((point): point is [number, number] => Boolean(point))
            : []
        ))
        .filter(segment => segment.length > 0)
    : []
);

export const readTrackDraft = (account: string): TrackDraftData | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getTrackDraftStorageKey(account));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrackDraftData>;
    const paths = normalizeTrackDraftPaths(parsed.paths);
    if (paths.length === 0) return null;
    return {
      paths,
      time: Math.max(0, Number(parsed.time) || 0),
      savedAt: Math.max(0, Number(parsed.savedAt) || Date.now()),
    };
  } catch {
    return null;
  }
};

export const writeTrackDraft = (account: string, draft: TrackDraftData) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getTrackDraftStorageKey(account), JSON.stringify(draft));
  } catch {
    // A route draft is only a recovery aid; storage quota errors should not stop tracking.
  }
};

export const clearTrackDraft = (account: string) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(getTrackDraftStorageKey(account));
  } catch {
    // Ignore local cleanup failures.
  }
};
