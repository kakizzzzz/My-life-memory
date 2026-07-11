import React from 'react';
import { HOME_COPY } from '../copy/homeCopy';
import { isCloudBackendEnabled } from '../lib/supabaseClient';
import {
  getCloudSession,
  loadCloudAccountData,
  loginCloudAccount,
  onCloudAuthStateChange,
  registerCloudAccount,
  signOutCloudAccount,
  CloudAuthError,
  type CloudAppState,
  type CloudAuthAction,
  type CloudProfile,
} from '../lib/cloudBackend';
import {
  clearMemoryMutationOutbox,
  enqueueMemoryMutations,
  markLegacyPendingSnapshotResolved,
  readMemoryMutationOutbox,
  upgradeLegacyPendingSnapshot,
  writeMemoryMutationOutbox,
  type MemoryMutationOutbox,
} from '../lib/memoryOutbox';
import {
  NormalizedMemoryConflictError,
  applyMemoryMutations,
} from '../lib/memoryRepository';
import {
  applyMemoryMutationsToSnapshot,
  compactMemoryMutations,
  diffMemoryState,
  MAX_MEMORY_MUTATIONS_PER_COMMIT,
  mutationsAreDisjointFromRemote,
  preserveMutationConflicts,
  reconcileMemoryMutationsAfterRemoteAdvance,
  rebaseMemoryMutationBases,
} from '../lib/normalizedMemory';
import {
  registerCloudConflictResolver,
  setCloudSyncStatus,
  type CloudConflictStrategy,
} from '../lib/cloudSyncStatus';
import { normalizePersistedAppState } from '../lib/appStateNormalize';
import { normalizeAccountId } from '../lib/accountUtils';
import {
  getPersistableAvatarUrl,
  getPublicProfileSnapshot,
} from '../lib/localPersistence';
import { storagePlaceholderSrc } from '../lib/mediaStorage';
import {
  createDefaultRecordStar,
  normalizeInitialStars,
} from '../lib/defaultStarUtils';
import {
  CLOUD_PASSWORD_MIN_LENGTH,
  DEFAULT_PROFILE,
} from '../constants/appDefaults';
import { DEFAULT_SYSTEM_THEME } from '../constants/theme';
import { DEFAULT_MAP_STYLE } from '../constants/mapTiles';
import type {
  AppView,
  HomePanel,
  MapStyle,
  PersistedAppState,
  ProfileConflictData,
  StarData,
  SystemTheme,
  TrackData,
  UserProfile,
} from '../types/app';

type HomeCopy = typeof HOME_COPY.en;

const CLOUD_SAVE_DEBOUNCE_MS = 650;
type CloudRevisionInfo = { revision: number; supported: boolean };

const newestMemoryOutbox = (
  first: MemoryMutationOutbox | null,
  second: MemoryMutationOutbox | null
) => {
  if (!first) return second;
  if (!second) return first;
  if (first.sequence !== second.sequence) return first.sequence > second.sequence ? first : second;
  return first.savedAt >= second.savedAt ? first : second;
};

export const useCloudAuthSync = ({
  canUseLocalAuthFallback,
  cloudConfigError,
  homeCopy,
  language,
  setLanguage,
  mapStyle,
  setMapStyle,
  systemTheme,
  setSystemTheme,
  profile,
  setProfile,
  isSignedIn,
  setIsSignedIn,
  stars,
  setStars,
  savedTracks,
  setSavedTracks,
  activeHomePanel,
  setActiveHomePanel,
  setActiveView,
  buildDefaultProfileName,
  syncDefaultStarNearUser,
  getLastGpsLocation,
}: {
  canUseLocalAuthFallback: boolean;
  cloudConfigError: string;
  homeCopy: HomeCopy;
  language: string;
  setLanguage: React.Dispatch<React.SetStateAction<string>>;
  mapStyle: MapStyle;
  setMapStyle: React.Dispatch<React.SetStateAction<MapStyle>>;
  systemTheme: SystemTheme;
  setSystemTheme: React.Dispatch<React.SetStateAction<SystemTheme>>;
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  isSignedIn: boolean;
  setIsSignedIn: React.Dispatch<React.SetStateAction<boolean>>;
  stars: StarData[];
  setStars: React.Dispatch<React.SetStateAction<StarData[]>>;
  savedTracks: TrackData[];
  setSavedTracks: React.Dispatch<React.SetStateAction<TrackData[]>>;
  activeHomePanel: HomePanel;
  setActiveHomePanel: React.Dispatch<React.SetStateAction<HomePanel>>;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  buildDefaultProfileName: (account: string) => string;
  syncDefaultStarNearUser: (newLoc: [number, number], force?: boolean) => void;
  getLastGpsLocation: () => [number, number] | null;
}) => {
  const [authMode, setAuthMode] = React.useState<CloudAuthAction>('login');
  const [loginAccount, setLoginAccount] = React.useState('');
  const [loginPassword, setLoginPassword] = React.useState('');
  const [registerInviteCode, setRegisterInviteCode] = React.useState('');
  const [isPasswordRevealed, setIsPasswordRevealed] = React.useState(false);
  const [loginError, setLoginError] = React.useState('');
  const [isAuthBusy, setIsAuthBusy] = React.useState(false);
  const [cloudAuthHydrating, setCloudAuthHydrating] = React.useState(() => isCloudBackendEnabled);
  const [profileConflicts, setProfileConflicts] = React.useState<ProfileConflictData[]>([]);
  const isApplyingCloudStateRef = React.useRef(false);
  const cloudReadyToSaveRef = React.useRef(!isCloudBackendEnabled);
  const cloudRegistrationInProgressRef = React.useRef(false);
  const cloudInteractiveAuthInProgressRef = React.useRef(false);
  const hydratingCloudSessionRef = React.useRef<{ userId: string; accessToken: string } | null>(null);
  const hydratedCloudUserIdRef = React.useRef<string | null>(null);
  const cloudSaveTimerRef = React.useRef<number | null>(null);
  const cloudUserIdRef = React.useRef<string | null>(null);
  const cloudRevisionRef = React.useRef(0);
  const cloudBaseStateRef = React.useRef<PersistedAppState>({});
  const cloudBaseProfileRef = React.useRef<CloudProfile>({ account: '', name: '', avatarUrl: '' });
  const cloudConflictRef = React.useRef(false);
  const pendingMemoryOutboxRef = React.useRef<MemoryMutationOutbox | null>(null);
  const cloudSaveSequenceRef = React.useRef(0);
  const cloudSaveInFlightRef = React.useRef(false);
  const cloudFlushRequestedRef = React.useRef(false);
  const cloudPersistenceChainRef = React.useRef<Promise<void>>(Promise.resolve());
  const flushCloudSaveRef = React.useRef<() => Promise<void>>(async () => {});

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : language === 'ko' ? 'ko' : 'en';
  }, [language]);

  const createAppStateSnapshot = React.useCallback((profileOverride?: Partial<UserProfile>): PersistedAppState => {
    const snapshotProfile = {
      ...profile,
      ...profileOverride,
    };

    return {
      mapStyle,
      systemTheme,
      profile: getPublicProfileSnapshot(snapshotProfile),
      profileConflicts,
      isSignedIn: isCloudBackendEnabled ? false : isSignedIn,
      language,
      stars,
      savedTracks,
    };
  }, [isSignedIn, language, mapStyle, profile, profileConflicts, savedTracks, stars, systemTheme]);
  const latestAppStateRef = React.useRef<PersistedAppState>({});
  const latestProfileSnapshotRef = React.useRef<CloudProfile>({ account: '', name: '', avatarUrl: '' });
  latestAppStateRef.current = createAppStateSnapshot();
  latestProfileSnapshotRef.current = {
    account: normalizeAccountId(profile.account),
    name: profile.name,
    avatarUrl: getPersistableAvatarUrl(profile),
  };

  const createCleanCloudInitialState = React.useCallback((account: string): PersistedAppState => ({
    mapStyle: DEFAULT_MAP_STYLE,
    systemTheme: DEFAULT_SYSTEM_THEME,
    profile: {
      account,
      name: buildDefaultProfileName(account),
      avatarUrl: '',
    },
    profileConflicts: [],
    isSignedIn: false,
    language,
    stars: [createDefaultRecordStar()],
    savedTracks: [],
  }), [buildDefaultProfileName, language]);

  const applyCloudSnapshot = React.useCallback((cloudProfile: CloudProfile, cloudState: CloudAppState | null) => {
    const remoteState = normalizePersistedAppState((cloudState || {}) as PersistedAppState) || {};
    const remoteProfile = remoteState.profile || {};
    const avatarImage = remoteProfile.avatarImage?.provider === 'supabase' && remoteProfile.avatarImage.path
      ? remoteProfile.avatarImage
      : undefined;
    isApplyingCloudStateRef.current = true;
    cloudReadyToSaveRef.current = false;

    setMapStyle(remoteState.mapStyle || DEFAULT_MAP_STYLE);
    if (remoteState.language) setLanguage(remoteState.language);
    setSystemTheme({
      ...DEFAULT_SYSTEM_THEME,
      ...(remoteState.systemTheme || {}),
    });
    setProfile(prev => ({
      ...DEFAULT_PROFILE,
      ...remoteProfile,
      name: cloudProfile.name || remoteProfile.name || buildDefaultProfileName(cloudProfile.account) || prev.name,
      account: cloudProfile.account,
      password: '',
      avatarUrl: avatarImage ? storagePlaceholderSrc(avatarImage) : cloudProfile.avatarUrl || remoteProfile.avatarUrl || prev.avatarUrl || '',
      avatarImage,
    }));
    setProfileConflicts(Array.isArray(remoteState.profileConflicts) ? remoteState.profileConflicts : []);
    setStars(normalizeInitialStars(remoteState.stars) || [createDefaultRecordStar()]);
    const lastGpsLocation = getLastGpsLocation();
    if (lastGpsLocation) {
      syncDefaultStarNearUser(lastGpsLocation, true);
    }
    setSavedTracks(Array.isArray(remoteState.savedTracks) ? remoteState.savedTracks : []);
    setIsSignedIn(true);
    setLoginAccount(cloudProfile.account);
    setLoginPassword('');
    setLoginError('');
    setActiveView('map');
    setActiveHomePanel(null);

    window.setTimeout(() => {
      isApplyingCloudStateRef.current = false;
      cloudReadyToSaveRef.current = true;
      if (pendingMemoryOutboxRef.current && !cloudConflictRef.current) {
        void flushCloudSaveRef.current();
      }
    }, 0);
  }, [
    buildDefaultProfileName,
    getLastGpsLocation,
    setActiveHomePanel,
    setActiveView,
    setIsSignedIn,
    setLanguage,
    setMapStyle,
    setProfile,
    setSavedTracks,
    setStars,
    setSystemTheme,
    syncDefaultStarNearUser,
  ]);

  const resolveCloudSnapshot = React.useCallback(async (
    userId: string,
    cloudProfile: CloudProfile,
    cloudState: CloudAppState | null,
    loadedRevisionInfo?: CloudRevisionInfo
  ) => {
    const revisionInfo = loadedRevisionInfo || { revision: 0, supported: true };
    const remotePersistedState = normalizePersistedAppState((cloudState || {}) as PersistedAppState) || {};
    const legacyUpgrade = await upgradeLegacyPendingSnapshot({
      userId,
      remoteState: remotePersistedState,
      remoteProfile: cloudProfile,
      remoteRevision: revisionInfo.revision,
    }).catch(error => {
      console.warn('Could not inspect legacy pending cloud data:', error);
      return { outbox: null, blocked: true };
    });
    let pendingOutbox = legacyUpgrade.outbox || await readMemoryMutationOutbox(userId).catch(error => {
      console.warn('Could not read the local memory outbox:', error);
      return null;
    });

    cloudUserIdRef.current = userId;
    cloudRevisionRef.current = revisionInfo.revision;
    cloudBaseStateRef.current = remotePersistedState;
    cloudBaseProfileRef.current = cloudProfile;
    pendingMemoryOutboxRef.current = pendingOutbox;

    if (pendingOutbox && pendingOutbox.mutations.length === 0 && !pendingOutbox.legacySnapshotBlocked) {
      await clearMemoryMutationOutbox(userId);
      pendingOutbox = null;
      pendingMemoryOutboxRef.current = null;
    }

    if (!pendingOutbox) {
      cloudConflictRef.current = false;
      setCloudSyncStatus('idle', language);
      applyCloudSnapshot(cloudProfile, cloudState);
      return;
    }

    if (legacyUpgrade.blocked || pendingOutbox.legacySnapshotBlocked) {
      cloudConflictRef.current = true;
      setCloudSyncStatus('conflict', pendingOutbox.language || language);
      applyCloudSnapshot(cloudProfile, cloudState);
      return;
    }

    let effectiveOutbox = pendingOutbox;
    if (pendingOutbox.expectedRevision !== revisionInfo.revision) {
      const unresolvedMutations = reconcileMemoryMutationsAfterRemoteAdvance({
        pendingMutations: pendingOutbox.mutations,
        inFlightMutations: pendingOutbox.inFlightBatch?.mutations || [],
        remoteState: remotePersistedState,
        remoteProfile: cloudProfile,
      });
      if (unresolvedMutations.length === 0) {
        pendingMemoryOutboxRef.current = null;
        await clearMemoryMutationOutbox(userId);
        cloudConflictRef.current = false;
        setCloudSyncStatus('synced', pendingOutbox.language || language);
        applyCloudSnapshot(cloudProfile, cloudState);
        return;
      }
      if (mutationsAreDisjointFromRemote(unresolvedMutations, remotePersistedState, cloudProfile)) {
        const rebasedMutations = rebaseMemoryMutationBases(
          unresolvedMutations,
          remotePersistedState,
          cloudProfile
        );
        effectiveOutbox = {
          ...pendingOutbox,
          expectedRevision: revisionInfo.revision,
          mutations: rebasedMutations,
          inFlightBatch: undefined,
        };
        pendingMemoryOutboxRef.current = effectiveOutbox;
        await writeMemoryMutationOutbox(effectiveOutbox);
      } else {
        cloudConflictRef.current = true;
      }
    } else {
      cloudConflictRef.current = false;
    }

    const localPreview = applyMemoryMutationsToSnapshot({
      state: remotePersistedState,
      profile: cloudProfile,
      mutations: effectiveOutbox.mutations,
    });
    setCloudSyncStatus(cloudConflictRef.current ? 'conflict' : 'local', effectiveOutbox.language || language);
    applyCloudSnapshot(localPreview.profile, localPreview.state as CloudAppState);
  }, [applyCloudSnapshot, language]);

  const getCloudAuthErrorMessage = React.useCallback((error: unknown, action: CloudAuthAction) => {
    const code = (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as CloudAuthError).code === 'string'
    ) ? (error as CloudAuthError).code : 'unknown';
    const detail = error instanceof CloudAuthError ? error.details : undefined;
    if (code === 'setup_required') {
      if (detail?.tokenRef && detail.clientProjectRef && detail.tokenRef !== detail.clientProjectRef) {
        return homeCopy.cloudProjectMismatch;
      }
      const text = String(detail?.message || (error instanceof Error ? error.message : '')).toLowerCase();
      if (text.includes('unable to reach supabase')) {
        return homeCopy.cloudConnectivityIssue;
      }
      return homeCopy.cloudSetupRequired;
    }
    if (code === 'registration_disabled') {
      return homeCopy.cloudEmailConfirmRequired;
    }
    if (code === 'invite_required') return homeCopy.inviteOnly;
    if (code === 'account_exists') return homeCopy.accountExists;
    if (code === 'weak_password') return homeCopy.passwordTooShort;
    if (code === 'invalid_credentials') {
      return homeCopy.loginError;
    }
    return action === 'register' ? homeCopy.registerError : homeCopy.loginError;
  }, [homeCopy]);

  const flushCloudSave = React.useCallback(async () => {
    if (!isCloudBackendEnabled || !cloudReadyToSaveRef.current || cloudConflictRef.current) return;
    if (cloudSaveInFlightRef.current) {
      cloudFlushRequestedRef.current = true;
      return;
    }

    const userId = cloudUserIdRef.current;
    if (!userId) return;
    let pendingOutbox = pendingMemoryOutboxRef.current;
    const storedOutbox = await readMemoryMutationOutbox(userId).catch(() => null);
    pendingOutbox = newestMemoryOutbox(pendingOutbox, storedOutbox);
    pendingMemoryOutboxRef.current = pendingOutbox;
    if (!pendingOutbox || pendingOutbox.mutations.length === 0) return;
    if (pendingOutbox.legacySnapshotBlocked) {
      cloudConflictRef.current = true;
      setCloudSyncStatus('conflict', pendingOutbox.language);
      return;
    }

    cloudSaveInFlightRef.current = true;
    cloudFlushRequestedRef.current = false;
    setCloudSyncStatus('syncing', pendingOutbox.language);
    const pendingBatch = pendingOutbox.mutations.slice(0, MAX_MEMORY_MUTATIONS_PER_COMMIT);
    const baseStateAtSend = cloudBaseStateRef.current;
    const baseProfileAtSend = cloudBaseProfileRef.current;

    try {
      pendingOutbox = {
        ...pendingOutbox,
        inFlightBatch: {
          expectedRevision: pendingOutbox.expectedRevision,
          mutations: pendingBatch,
          startedAt: Date.now(),
        },
      };
      pendingMemoryOutboxRef.current = pendingOutbox;
      await writeMemoryMutationOutbox(pendingOutbox);
      const result = await applyMemoryMutations(pendingOutbox.expectedRevision, pendingBatch);
      const confirmed = applyMemoryMutationsToSnapshot({
        state: baseStateAtSend,
        profile: baseProfileAtSend,
        mutations: pendingBatch,
      });

      if (cloudUserIdRef.current !== userId) {
        const storedLatestOutbox = await readMemoryMutationOutbox(userId).catch(() => null);
        const latestOldUserOutbox = newestMemoryOutbox(pendingOutbox, storedLatestOutbox) || pendingOutbox;
        const confirmedIds = new Set(pendingBatch.map(item => item.mutationId));
        const remainingOldUserMutations = rebaseMemoryMutationBases(
          latestOldUserOutbox.mutations.filter(item => !confirmedIds.has(item.mutationId)),
          confirmed.state,
          confirmed.profile
        );
        if (remainingOldUserMutations.length === 0) {
          await clearMemoryMutationOutbox(userId);
        } else {
          await writeMemoryMutationOutbox({
            ...latestOldUserOutbox,
            expectedRevision: result.revision,
            mutations: remainingOldUserMutations,
            inFlightBatch: undefined,
            sequence: latestOldUserOutbox.sequence + 1,
          });
        }
        return;
      }

      cloudRevisionRef.current = result.revision;
      cloudBaseStateRef.current = confirmed.state;
      cloudBaseProfileRef.current = confirmed.profile;

      await cloudPersistenceChainRef.current.catch(() => {});
      const storedLatestOutbox = await readMemoryMutationOutbox(userId).catch(() => null);
      const latestOutbox = newestMemoryOutbox(pendingMemoryOutboxRef.current, storedLatestOutbox);
      pendingMemoryOutboxRef.current = latestOutbox;
      const confirmedIds = new Set(pendingBatch.map(item => item.mutationId));
      const remaining = rebaseMemoryMutationBases(
        latestOutbox?.mutations.filter(item => !confirmedIds.has(item.mutationId)) || [],
        confirmed.state,
        confirmed.profile
      );
      const remainingPreview = applyMemoryMutationsToSnapshot({
        state: confirmed.state,
        profile: confirmed.profile,
        mutations: remaining,
      });
      const supplemental = diffMemoryState({
        baseState: remainingPreview.state,
        nextState: latestAppStateRef.current,
        baseProfile: remainingPreview.profile,
        nextProfile: latestProfileSnapshotRef.current,
      });
      const nextMutations = compactMemoryMutations([...remaining, ...supplemental]);
      if (nextMutations.length === 0) {
        pendingMemoryOutboxRef.current = null;
        await clearMemoryMutationOutbox(userId).catch(error => {
          console.warn('Memory changes synced but local outbox cleanup failed:', error);
        });
        setCloudSyncStatus('synced', pendingOutbox.language);
      } else {
        const rebasedOutbox: MemoryMutationOutbox = {
          ...(latestOutbox || pendingOutbox),
          expectedRevision: result.revision,
          mutations: nextMutations,
          inFlightBatch: undefined,
          sequence: Math.max(latestOutbox?.sequence || 0, pendingOutbox.sequence) + 1,
        };
        pendingMemoryOutboxRef.current = rebasedOutbox;
        await writeMemoryMutationOutbox(rebasedOutbox);
        setCloudSyncStatus('local', rebasedOutbox.language);
        cloudFlushRequestedRef.current = true;
      }
    } catch (error) {
      if (error instanceof NormalizedMemoryConflictError) {
        if (cloudUserIdRef.current !== userId) return;
        try {
          const session = await getCloudSession();
          if (!session?.user || session.user.id !== userId) throw new Error('No active cloud session.');
          const remote = await loadCloudAccountData(session.user);
          const remoteState = normalizePersistedAppState((remote.state || {}) as PersistedAppState) || {};
          await cloudPersistenceChainRef.current.catch(() => {});
          const storedLatestOutbox = await readMemoryMutationOutbox(userId).catch(() => null);
          const latestOutbox = newestMemoryOutbox(
            pendingMemoryOutboxRef.current || pendingOutbox,
            storedLatestOutbox
          ) || pendingOutbox;
          cloudRevisionRef.current = remote.revision;
          cloudBaseStateRef.current = remoteState;
          cloudBaseProfileRef.current = remote.profile;

          const unresolvedMutations = reconcileMemoryMutationsAfterRemoteAdvance({
            pendingMutations: latestOutbox.mutations,
            inFlightMutations: latestOutbox.inFlightBatch?.mutations || pendingBatch,
            remoteState,
            remoteProfile: remote.profile,
          });
          if (unresolvedMutations.length > 0
            && !mutationsAreDisjointFromRemote(unresolvedMutations, remoteState, remote.profile)) {
            cloudConflictRef.current = true;
            setCloudSyncStatus('conflict', latestOutbox.language);
          } else {
            const unresolvedPreview = applyMemoryMutationsToSnapshot({
              state: remoteState,
              profile: remote.profile,
              mutations: unresolvedMutations,
            });
            const supplemental = diffMemoryState({
              baseState: unresolvedPreview.state,
              nextState: latestAppStateRef.current,
              baseProfile: unresolvedPreview.profile,
              nextProfile: latestProfileSnapshotRef.current,
            });
            const rebasedMutations = compactMemoryMutations([...unresolvedMutations, ...supplemental]);
            if (rebasedMutations.length === 0) {
              pendingMemoryOutboxRef.current = null;
              await clearMemoryMutationOutbox(userId);
              cloudConflictRef.current = false;
              setCloudSyncStatus('synced', latestOutbox.language);
              applyCloudSnapshot(remote.profile, remote.state);
            } else {
              const rebasedOutbox = {
                ...latestOutbox,
                expectedRevision: remote.revision,
                mutations: rebasedMutations,
                inFlightBatch: undefined,
                sequence: latestOutbox.sequence + 1,
              };
              pendingMemoryOutboxRef.current = rebasedOutbox;
              await writeMemoryMutationOutbox(rebasedOutbox);
              const preview = applyMemoryMutationsToSnapshot({
                state: remoteState,
                profile: remote.profile,
                mutations: rebasedOutbox.mutations,
              });
              cloudConflictRef.current = false;
              setCloudSyncStatus('local', rebasedOutbox.language);
              applyCloudSnapshot(preview.profile, preview.state as CloudAppState);
              cloudFlushRequestedRef.current = true;
            }
          }
        } catch (comparisonError) {
          console.warn('Could not inspect normalized memory conflict:', comparisonError);
          cloudConflictRef.current = true;
          setCloudSyncStatus('conflict', pendingOutbox.language);
        }
      } else {
        console.error('Could not save normalized memory changes:', error);
        const storedFailedOutbox = await readMemoryMutationOutbox(userId).catch(() => null);
        const failedOutbox = {
          ...(newestMemoryOutbox(
            cloudUserIdRef.current === userId ? pendingMemoryOutboxRef.current : null,
            storedFailedOutbox
          ) || pendingOutbox),
          lastError: error instanceof Error ? error.message : 'Normalized memory save failed.',
        };
        if (cloudUserIdRef.current === userId) pendingMemoryOutboxRef.current = failedOutbox;
        await writeMemoryMutationOutbox(failedOutbox).catch(() => {});
        if (cloudUserIdRef.current === userId) setCloudSyncStatus('error', pendingOutbox.language);
      }
    } finally {
      cloudSaveInFlightRef.current = false;
      if (cloudFlushRequestedRef.current && !cloudConflictRef.current) {
        cloudFlushRequestedRef.current = false;
        queueMicrotask(() => void flushCloudSaveRef.current());
      }
    }
  }, [applyCloudSnapshot]);

  React.useEffect(() => {
    flushCloudSaveRef.current = flushCloudSave;
  }, [flushCloudSave]);

  const resolveCloudConflict = React.useCallback(async (strategy: CloudConflictStrategy) => {
    const userId = cloudUserIdRef.current;
    if (!userId || !cloudConflictRef.current) return;

    setCloudSyncStatus('syncing', language);
    const session = await getCloudSession();
    if (!session?.user || session.user.id !== userId) throw new Error('No active cloud session.');
    const { profile: cloudProfile, state: remoteState, revision } = await loadCloudAccountData(session.user);
    const normalizedRemoteState = normalizePersistedAppState((remoteState || {}) as PersistedAppState) || {};
    const pendingOutbox = pendingMemoryOutboxRef.current || await readMemoryMutationOutbox(userId);

    cloudRevisionRef.current = revision;
    cloudBaseStateRef.current = normalizedRemoteState;
    cloudBaseProfileRef.current = cloudProfile;

    if (strategy === 'cloud') {
      if (pendingOutbox?.legacySnapshotBlocked) await markLegacyPendingSnapshotResolved(userId);
      await clearMemoryMutationOutbox(userId);
      pendingMemoryOutboxRef.current = null;
      cloudConflictRef.current = false;
      setCloudSyncStatus('idle', language);
      applyCloudSnapshot(cloudProfile, remoteState);
      return;
    }

    if (!pendingOutbox || pendingOutbox.legacySnapshotBlocked) {
      setCloudSyncStatus('conflict', pendingOutbox?.language || language);
      return;
    }

    const mutations = strategy === 'merge'
      ? preserveMutationConflicts(
          pendingOutbox.mutations,
          normalizedRemoteState,
          cloudProfile,
          pendingOutbox.language,
          latestAppStateRef.current
        )
      : pendingOutbox.mutations;
    const rebasedOutbox: MemoryMutationOutbox = {
      ...pendingOutbox,
      expectedRevision: revision,
      mutations,
      inFlightBatch: undefined,
      sequence: pendingOutbox.sequence + 1,
    };
    pendingMemoryOutboxRef.current = rebasedOutbox;
    await writeMemoryMutationOutbox(rebasedOutbox);
    cloudConflictRef.current = false;
    setCloudSyncStatus('local', rebasedOutbox.language);

    if (strategy === 'merge') {
      const preview = applyMemoryMutationsToSnapshot({
        state: normalizedRemoteState,
        profile: cloudProfile,
        mutations,
      });
      applyCloudSnapshot(preview.profile, preview.state as CloudAppState);
    } else {
      await flushCloudSaveRef.current();
    }
  }, [applyCloudSnapshot, language]);

  React.useEffect(() => {
    registerCloudConflictResolver(resolveCloudConflict);
    return () => registerCloudConflictResolver(null);
  }, [resolveCloudConflict]);

  const hydrateCloudSession = React.useCallback(async (session: Awaited<ReturnType<typeof getCloudSession>>) => {
    if (!isCloudBackendEnabled) return;
    if (cloudRegistrationInProgressRef.current) return;
    if (cloudInteractiveAuthInProgressRef.current) return;

    if (!session?.user) {
      hydratingCloudSessionRef.current = null;
      hydratedCloudUserIdRef.current = null;
      cloudUserIdRef.current = null;
      cloudReadyToSaveRef.current = false;
      setCloudAuthHydrating(false);
      setIsSignedIn(false);
      setActiveHomePanel(null);
      setCloudSyncStatus('idle', language);
      return;
    }

    const userId = session.user.id;
    const accessToken = session.access_token || '';
    const hydratingSession = hydratingCloudSessionRef.current;

    if (
      hydratingSession &&
      (hydratingSession.userId === userId || Boolean(accessToken && hydratingSession.accessToken === accessToken))
    ) {
      return;
    }

    if (hydratedCloudUserIdRef.current === userId) {
      setCloudAuthHydrating(false);
      return;
    }

    hydratingCloudSessionRef.current = { userId, accessToken };
    setCloudAuthHydrating(true);

    try {
      const { profile: cloudProfile, state, revision, revisionSupported } = await loadCloudAccountData(session.user);
      await resolveCloudSnapshot(userId, cloudProfile, state, {
        revision,
        supported: revisionSupported,
      });
      hydratedCloudUserIdRef.current = userId;
    } catch (error) {
      console.error('Could not load cloud account data:', error);
      setLoginError(getCloudAuthErrorMessage(error, 'login'));
      hydratedCloudUserIdRef.current = null;
      cloudUserIdRef.current = null;
      cloudReadyToSaveRef.current = false;
      setIsSignedIn(false);
      setActiveHomePanel(null);
      void signOutCloudAccount();
    } finally {
      if (hydratingCloudSessionRef.current?.userId === userId) {
        hydratingCloudSessionRef.current = null;
      }
      setCloudAuthHydrating(false);
    }
  }, [getCloudAuthErrorMessage, language, resolveCloudSnapshot, setActiveHomePanel, setIsSignedIn]);
  const hydrateCloudSessionRef = React.useRef(hydrateCloudSession);

  React.useEffect(() => {
    hydrateCloudSessionRef.current = hydrateCloudSession;
  }, [hydrateCloudSession]);

  const buildCloudAuthPayload = React.useCallback((enteredAccount: string) => {
    const normalizedAccount = normalizeAccountId(enteredAccount);
    const initialProfileForCloud: CloudProfile = {
      account: normalizedAccount,
      name: buildDefaultProfileName(normalizedAccount),
      avatarUrl: '',
    };
    const initialState = createCleanCloudInitialState(normalizedAccount) as CloudAppState;

    return {
      normalizedAccount,
      initialProfileForCloud,
      initialState,
    };
  }, [buildDefaultProfileName, createCleanCloudInitialState]);

  React.useEffect(() => {
    setIsPasswordRevealed(false);
  }, [authMode, activeHomePanel]);

  const handleLogin = React.useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const enteredAccount = loginAccount.trim();
    setAuthMode('login');
    setIsPasswordRevealed(false);

    if (isAuthBusy) return;

    if (cloudConfigError) {
      setLoginError(homeCopy.cloudConfigInvalid);
      return;
    }

    if (!enteredAccount || !loginPassword) {
      setLoginError(homeCopy.loginMissing);
      return;
    }

    if (isCloudBackendEnabled) {
      setIsAuthBusy(true);
      setLoginError('');
      cloudInteractiveAuthInProgressRef.current = true;

      try {
        const {
          normalizedAccount,
        } = buildCloudAuthPayload(enteredAccount);
        const result = await loginCloudAccount({
          account: normalizedAccount,
          password: loginPassword,
        });
        const session = await getCloudSession();

        if (session?.user) {
          await resolveCloudSnapshot(session.user.id, result.profile, result.state, {
            revision: result.revision,
            supported: result.revisionSupported,
          });
          hydratedCloudUserIdRef.current = session.user.id;
        } else {
          applyCloudSnapshot(result.profile, result.state);
        }
      } catch (error) {
        console.error('Cloud login failed:', error);
        cloudReadyToSaveRef.current = false;
        cloudUserIdRef.current = null;
        void signOutCloudAccount();
        setLoginError(getCloudAuthErrorMessage(error, 'login'));
      } finally {
        cloudInteractiveAuthInProgressRef.current = false;
        setIsAuthBusy(false);
      }

      return;
    }

    const storedAccount = profile.account.trim();
    const accountMatches = storedAccount ? enteredAccount === storedAccount : enteredAccount.length > 0;
    const passwordMatches = Boolean(profile.password) && loginPassword === profile.password;

    if (!storedAccount || !accountMatches || !passwordMatches) {
      setLoginError(homeCopy.loginError);
      return;
    }

    setIsSignedIn(true);
    setLoginError('');
    setLoginPassword('');
    setActiveView('map');
    setActiveHomePanel(null);
  }, [
    applyCloudSnapshot,
    buildCloudAuthPayload,
    cloudConfigError,
    getCloudAuthErrorMessage,
    homeCopy,
    isAuthBusy,
    loginAccount,
    loginPassword,
    profile.account,
    profile.password,
    resolveCloudSnapshot,
    setActiveHomePanel,
    setActiveView,
    setIsSignedIn,
  ]);

  const handleRegister = React.useCallback(async (event?: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    const enteredAccount = loginAccount.trim();
    setAuthMode('register');
    setIsPasswordRevealed(false);
    if (isAuthBusy) return;

    if (!enteredAccount || !loginPassword) {
      setLoginError(homeCopy.registerMissing);
      return;
    }

    if (cloudConfigError) {
      setLoginError(homeCopy.cloudConfigInvalid);
      return;
    }

    if (loginPassword.length < CLOUD_PASSWORD_MIN_LENGTH) {
      setLoginError(homeCopy.passwordTooShort);
      return;
    }

    if (isCloudBackendEnabled && !registerInviteCode.trim()) {
      setLoginError(homeCopy.inviteOnly);
      return;
    }

    if (canUseLocalAuthFallback) {
      setProfile(prev => ({
        ...prev,
        name: prev.name || buildDefaultProfileName(enteredAccount),
        account: enteredAccount,
        password: loginPassword,
      }));
      setIsSignedIn(false);
      setAuthMode('login');
      setLoginError(homeCopy.registerSuccess);
      setLoginPassword('');
      return;
    }

    setIsAuthBusy(true);
    setLoginError('');
    cloudRegistrationInProgressRef.current = true;

    try {
      const {
        normalizedAccount,
        initialProfileForCloud,
        initialState,
      } = buildCloudAuthPayload(enteredAccount);
      await registerCloudAccount({
        account: normalizedAccount,
        password: loginPassword,
        inviteCode: registerInviteCode,
        initialProfile: initialProfileForCloud,
        initialState,
      });

      cloudReadyToSaveRef.current = false;
      setIsSignedIn(false);
      setAuthMode('login');
      setLoginAccount(normalizedAccount);
      setLoginPassword('');
      setRegisterInviteCode('');
      setLoginError(homeCopy.registerSuccess);
    } catch (error) {
      console.error('Cloud register failed:', error);
      cloudReadyToSaveRef.current = false;
      void signOutCloudAccount();
      setLoginError(getCloudAuthErrorMessage(error, 'register'));
    } finally {
      cloudRegistrationInProgressRef.current = false;
      setIsAuthBusy(false);
    }
  }, [
    buildCloudAuthPayload,
    buildDefaultProfileName,
    canUseLocalAuthFallback,
    cloudConfigError,
    getCloudAuthErrorMessage,
    homeCopy,
    isAuthBusy,
    loginAccount,
    loginPassword,
    registerInviteCode,
    setIsSignedIn,
    setProfile,
  ]);

  const handleSignOut = React.useCallback(() => {
    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
      cloudSaveTimerRef.current = null;
    }
    if (isCloudBackendEnabled) {
      cloudReadyToSaveRef.current = false;
      hydratingCloudSessionRef.current = null;
      hydratedCloudUserIdRef.current = null;
      cloudUserIdRef.current = null;
      pendingMemoryOutboxRef.current = null;
      cloudConflictRef.current = false;
      setCloudAuthHydrating(false);
      void signOutCloudAccount();
    }
    setCloudSyncStatus('idle', language);
    setActiveHomePanel(null);
    setIsSignedIn(false);
    setLoginAccount('');
    setLoginPassword('');
    setIsPasswordRevealed(false);
    setLoginError('');
    setProfileConflicts([]);
  }, [language, setActiveHomePanel, setIsSignedIn]);

  React.useEffect(() => {
    if (!isCloudBackendEnabled) return;

    let isMounted = true;
    setCloudAuthHydrating(true);
    void getCloudSession().then(session => {
      if (!isMounted) return;
      void hydrateCloudSessionRef.current(session);
    }).catch(error => {
      console.error('Could not restore cloud session:', error);
      if (isMounted) setCloudAuthHydrating(false);
    });

    const unsubscribe = onCloudAuthStateChange(session => {
      if (!isMounted) return;
      void hydrateCloudSessionRef.current(session);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    if (
      !isCloudBackendEnabled ||
      !isSignedIn ||
      !cloudReadyToSaveRef.current ||
      isApplyingCloudStateRef.current
    ) return;

    const userId = cloudUserIdRef.current;
    if (!userId) return;

    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }

    const nextState = createAppStateSnapshot();
    const nextProfile: CloudProfile = {
      account: normalizeAccountId(profile.account),
      name: profile.name,
      avatarUrl: getPersistableAvatarUrl(profile),
    };
    const sequence = cloudSaveSequenceRef.current + 1;
    cloudSaveSequenceRef.current = sequence;

    cloudPersistenceChainRef.current = cloudPersistenceChainRef.current
      .catch(() => {})
      .then(async () => {
        const pendingOutbox = pendingMemoryOutboxRef.current || await readMemoryMutationOutbox(userId);
        const reference = pendingOutbox
          ? applyMemoryMutationsToSnapshot({
              state: cloudBaseStateRef.current,
              profile: cloudBaseProfileRef.current,
              mutations: pendingOutbox.mutations,
            })
          : { state: cloudBaseStateRef.current, profile: cloudBaseProfileRef.current };
        const mutations = diffMemoryState({
          baseState: reference.state,
          nextState,
          baseProfile: reference.profile,
          nextProfile,
        });
        if (mutations.length === 0) return;
        const savedOutbox = await enqueueMemoryMutations({
          userId,
          expectedRevision: pendingOutbox?.expectedRevision ?? cloudRevisionRef.current,
          mutations,
          language,
        });
        pendingMemoryOutboxRef.current = savedOutbox;
        if (!savedOutbox || cloudSaveSequenceRef.current !== sequence) return;
        setCloudSyncStatus(cloudConflictRef.current ? 'conflict' : 'local', language);
        if (cloudConflictRef.current) return;
        cloudSaveTimerRef.current = window.setTimeout(() => {
          cloudSaveTimerRef.current = null;
          void flushCloudSaveRef.current();
        }, CLOUD_SAVE_DEBOUNCE_MS);
      })
      .catch(error => {
        console.error('Could not persist normalized memory changes:', error);
        setCloudSyncStatus('error', language);
      });

    return () => {
      if (cloudSaveTimerRef.current !== null) {
        window.clearTimeout(cloudSaveTimerRef.current);
        cloudSaveTimerRef.current = null;
      }
    };
  }, [createAppStateSnapshot, isSignedIn, language, profile.account, profile.avatarImage, profile.avatarUrl, profile.name]);

  React.useEffect(() => {
    if (!isCloudBackendEnabled) return;
    const retryPendingSave = () => {
      if (!cloudConflictRef.current) void flushCloudSaveRef.current();
    };
    window.addEventListener('online', retryPendingSave);
    window.addEventListener('focus', retryPendingSave);
    return () => {
      window.removeEventListener('online', retryPendingSave);
      window.removeEventListener('focus', retryPendingSave);
    };
  }, []);

  React.useEffect(() => () => {
    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }
  }, []);

  return {
    authMode,
    setAuthMode,
    loginAccount,
    setLoginAccount,
    loginPassword,
    setLoginPassword,
    registerInviteCode,
    setRegisterInviteCode,
    isPasswordRevealed,
    setIsPasswordRevealed,
    loginError,
    setLoginError,
    isAuthBusy,
    cloudAuthHydrating,
    profileConflicts,
    handleLogin,
    handleRegister,
    handleSignOut,
    getCloudAuthErrorMessage,
  };
};
