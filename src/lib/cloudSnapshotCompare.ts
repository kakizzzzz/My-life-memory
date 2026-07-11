import type { CloudProfile } from './cloudBackend';
import { normalizePersistedAppState } from './appStateNormalize';
import { normalizeAccountId } from './accountUtils';
import type { PersistedAppState } from '../types/app';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
};

const same = (left: unknown, right: unknown) => (
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
);

const comparableProfile = (profile: CloudProfile) => ({
  account: normalizeAccountId(profile.account),
  name: profile.name || '',
  avatarUrl: profile.avatarUrl || '',
});

export const compareCloudSnapshots = (
  localState: PersistedAppState,
  localProfile: CloudProfile,
  remoteState: PersistedAppState,
  remoteProfile: CloudProfile
) => ({
  stateEqual: same(
    normalizePersistedAppState(localState) || {},
    normalizePersistedAppState(remoteState) || {}
  ),
  profileEqual: same(comparableProfile(localProfile), comparableProfile(remoteProfile)),
});
