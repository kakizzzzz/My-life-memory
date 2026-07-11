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
  CloudStateConflictError,
  clearPendingCloudSnapshot,
  readCloudStateRevision,
  readPendingCloudSnapshot,
  saveCloudSnapshotVersioned,
  writePendingCloudSnapshot,
  type CloudRevisionInfo,
  type PendingCloudSnapshot,
} from '../lib/cloudSyncPersistence';
import {
  registerCloudConflictResolver,
  setCloudSyncStatus,
  type CloudConflictStrategy,
} from '../lib/cloudSyncStatus';
import { normalizePersistedAppState } from '../lib/appStateNormalize';
import { mergeCloudConflictState } from '../lib/cloudConflictMerge';
import { compareCloudSnapshots } from '../lib/cloudSnapshotCompare';
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

export const useCloudAuthSync = ({
  canUseLocalAuthFallback,
  cloudConfigError,
  homeCopy,
  language,
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
  const cloudRevisionSupportedRef = React.useRef(false);
  const cloudBaseStateRef = React.useRef<PersistedAppState>({});
  const cloudConflictRef = React.useRef(false);
  const pendingCloudSnapshotRef = React.useRef<PendingCloudSnapshot | null>(null);
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

    setMapStyle(DEFAULT_MAP_STYLE);
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
      if (pendingCloudSnapshotRef.current && !cloudConflictRef.current) {
        void flushCloudSaveRef.current();
      }
    }, 0);
  }, [
    buildDefaultProfileName,
    getLastGpsLocation,
    setActiveHomePanel,
    setActiveView,
    setIsSignedIn,
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
    const revisionInfo = loadedRevisionInfo || await readCloudStateRevision(userId);
    const pendingSnapshot = await readPendingCloudSnapshot(userId).catch(error => {
      console.warn('Could not read pending cloud snapshot:', error);
      return null;
    });

    cloudUserIdRef.current = userId;
    cloudRevisionRef.current = revisionInfo.revision;
    cloudRevisionSupportedRef.current = revisionInfo.supported;
    cloudBaseStateRef.current = normalizePersistedAppState((cloudState || {}) as PersistedAppState) || {};
    pendingCloudSnapshotRef.current = pendingSnapshot;

    if (pendingSnapshot) {
      const hasConflict = revisionInfo.supported && pendingSnapshot.baseRevision !== revisionInfo.revision;
      if (hasConflict) {
        const remotePersistedState = normalizePersistedAppState((cloudState || {}) as PersistedAppState) || {};
        const comparison = compareCloudSnapshots(
          pendingSnapshot.state,
          pendingSnapshot.profile,
          remotePersistedState,
          cloudProfile
        );
        if (comparison.stateEqual) {
          cloudConflictRef.current = false;
          cloudBaseStateRef.current = remotePersistedState;
          if (comparison.profileEqual) {
            pendingCloudSnapshotRef.current = null;
            await clearPendingCloudSnapshot(userId);
            setCloudSyncStatus('idle', pendingSnapshot.language || language);
            applyCloudSnapshot(cloudProfile, cloudState);
          } else {
            const rebasedSnapshot: PendingCloudSnapshot = {
              ...pendingSnapshot,
              baseRevision: revisionInfo.revision,
              baseState: remotePersistedState,
            };
            pendingCloudSnapshotRef.current = rebasedSnapshot;
            await writePendingCloudSnapshot(rebasedSnapshot);
            setCloudSyncStatus('local', rebasedSnapshot.language || language);
            applyCloudSnapshot(rebasedSnapshot.profile, rebasedSnapshot.state as CloudAppState);
          }
          return;
        }
      }
      cloudConflictRef.current = hasConflict;
      setCloudSyncStatus(hasConflict ? 'conflict' : 'local', pendingSnapshot.language || language);
      applyCloudSnapshot(pendingSnapshot.profile, pendingSnapshot.state as CloudAppState);
      return;
    }

    cloudConflictRef.current = false;
    setCloudSyncStatus('idle', language);
    applyCloudSnapshot(cloudProfile, cloudState);
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
    if (
      !isCloudBackendEnabled ||
      !cloudReadyToSaveRef.current ||
      cloudConflictRef.current
    ) return;

    if (cloudSaveInFlightRef.current) {
      cloudFlushRequestedRef.current = true;
      return;
    }

    const userId = cloudUserIdRef.current;
    if (!userId) return;

    let pendingSnapshot = pendingCloudSnapshotRef.current;
    if (!pendingSnapshot) {
      pendingSnapshot = await readPendingCloudSnapshot(userId).catch(() => null);
      pendingCloudSnapshotRef.current = pendingSnapshot;
    }
    if (!pendingSnapshot) return;

    cloudSaveInFlightRef.current = true;
    cloudFlushRequestedRef.current = false;
    setCloudSyncStatus('syncing', pendingSnapshot.language);

    try {
      const revisionInfo = await saveCloudSnapshotVersioned(
        pendingSnapshot.state,
        pendingSnapshot.profile,
        pendingSnapshot.baseRevision,
        cloudRevisionSupportedRef.current
      );
      cloudRevisionRef.current = revisionInfo.revision;
      cloudRevisionSupportedRef.current = revisionInfo.supported;
      cloudBaseStateRef.current = pendingSnapshot.state;

      const latestSnapshot = pendingCloudSnapshotRef.current;
      if (!latestSnapshot || latestSnapshot.sequence === pendingSnapshot.sequence) {
        pendingCloudSnapshotRef.current = null;
        try {
          await clearPendingCloudSnapshot(userId);
        } catch (error) {
          console.warn('Cloud state synced but pending snapshot cleanup failed:', error);
        }
        setCloudSyncStatus('synced', pendingSnapshot.language);
      } else {
        const rebasedSnapshot: PendingCloudSnapshot = {
          ...latestSnapshot,
          baseRevision: revisionInfo.revision,
          baseState: pendingSnapshot.state,
        };
        pendingCloudSnapshotRef.current = rebasedSnapshot;
        try {
          await writePendingCloudSnapshot(rebasedSnapshot);
        } catch (error) {
          console.warn('Could not rebase pending cloud snapshot:', error);
          setCloudSyncStatus('error', rebasedSnapshot.language);
        }
        cloudFlushRequestedRef.current = true;
      }
    } catch (error) {
      if (error instanceof CloudStateConflictError) {
        let resolvedAsEquivalent = false;
        try {
          const session = await getCloudSession();
          if (session?.user?.id === userId) {
            const remote = await loadCloudAccountData(session.user);
            const remotePersistedState = normalizePersistedAppState((remote.state || {}) as PersistedAppState) || {};
            const comparison = compareCloudSnapshots(
              pendingSnapshot.state,
              pendingSnapshot.profile,
              remotePersistedState,
              remote.profile
            );
            if (comparison.stateEqual) {
              cloudRevisionRef.current = remote.revision;
              cloudRevisionSupportedRef.current = remote.revisionSupported;
              cloudBaseStateRef.current = remotePersistedState;
              cloudConflictRef.current = false;
              if (comparison.profileEqual) {
                pendingCloudSnapshotRef.current = null;
                await clearPendingCloudSnapshot(userId);
                setCloudSyncStatus('synced', pendingSnapshot.language);
                resolvedAsEquivalent = true;
              } else {
                const rebasedSnapshot: PendingCloudSnapshot = {
                  ...pendingSnapshot,
                  baseRevision: remote.revision,
                  baseState: remotePersistedState,
                };
                pendingCloudSnapshotRef.current = rebasedSnapshot;
                await writePendingCloudSnapshot(rebasedSnapshot);
                setCloudSyncStatus('local', rebasedSnapshot.language);
                cloudFlushRequestedRef.current = true;
                resolvedAsEquivalent = true;
              }
            }
          }
        } catch (comparisonError) {
          console.warn('Could not compare the conflicting cloud snapshot:', comparisonError);
        }
        if (!resolvedAsEquivalent) {
          cloudConflictRef.current = true;
          setCloudSyncStatus('conflict', pendingSnapshot.language);
        }
      } else {
        console.error('Could not save cloud app state:', error);
        setCloudSyncStatus('error', pendingSnapshot.language);
      }
    } finally {
      cloudSaveInFlightRef.current = false;
      if (cloudFlushRequestedRef.current && !cloudConflictRef.current) {
        cloudFlushRequestedRef.current = false;
        queueMicrotask(() => {
          void flushCloudSaveRef.current();
        });
      }
    }
  }, []);

  React.useEffect(() => {
    flushCloudSaveRef.current = flushCloudSave;
  }, [flushCloudSave]);

  const resolveCloudConflict = React.useCallback(async (strategy: CloudConflictStrategy) => {
    const userId = cloudUserIdRef.current;
    if (!userId || !cloudConflictRef.current) return;

    setCloudSyncStatus('syncing', language);
    const session = await getCloudSession();
    if (!session?.user || session.user.id !== userId) throw new Error('No active cloud session.');
    const {
      profile: cloudProfile,
      state: remoteState,
      revision,
      revisionSupported,
    } = await loadCloudAccountData(session.user);
    const revisionInfo = { revision, supported: revisionSupported };
    const normalizedRemoteState = normalizePersistedAppState((remoteState || {}) as PersistedAppState) || {};

    if (strategy === 'local' || strategy === 'merge') {
      const pendingSnapshot = pendingCloudSnapshotRef.current || await readPendingCloudSnapshot(userId);
      if (!pendingSnapshot) {
        cloudConflictRef.current = false;
        setCloudSyncStatus('idle', language);
        return;
      }
      const nextState = strategy === 'merge'
        ? mergeCloudConflictState(
            pendingSnapshot.baseState,
            pendingSnapshot.state,
            normalizedRemoteState,
            pendingSnapshot.language
          )
        : pendingSnapshot.state;
      const mergedProfileState = nextState.profile || {};
      const rebasedSnapshot = {
        ...pendingSnapshot,
        state: nextState,
        profile: {
          account: pendingSnapshot.profile.account || cloudProfile.account,
          name: mergedProfileState.name || pendingSnapshot.profile.name || cloudProfile.name,
          avatarUrl: mergedProfileState.avatarUrl || pendingSnapshot.profile.avatarUrl || cloudProfile.avatarUrl,
        },
        baseRevision: revisionInfo.revision,
        baseState: normalizedRemoteState,
      };
      cloudRevisionRef.current = revisionInfo.revision;
      cloudRevisionSupportedRef.current = revisionInfo.supported;
      cloudBaseStateRef.current = normalizedRemoteState;
      pendingCloudSnapshotRef.current = rebasedSnapshot;
      await writePendingCloudSnapshot(rebasedSnapshot);
      cloudConflictRef.current = false;
      setCloudSyncStatus('local', rebasedSnapshot.language);
      if (strategy === 'merge') {
        applyCloudSnapshot(rebasedSnapshot.profile, rebasedSnapshot.state as CloudAppState);
      } else {
        await flushCloudSaveRef.current();
      }
      return;
    }

    await clearPendingCloudSnapshot(userId);
    pendingCloudSnapshotRef.current = null;
    cloudConflictRef.current = false;
    await resolveCloudSnapshot(userId, cloudProfile, remoteState, revisionInfo);
  }, [applyCloudSnapshot, language, resolveCloudSnapshot]);

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
          initialProfileForCloud,
          initialState,
        } = buildCloudAuthPayload(enteredAccount);
        const result = await loginCloudAccount({
          account: normalizedAccount,
          password: loginPassword,
          initialProfile: initialProfileForCloud,
          initialState,
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
      pendingCloudSnapshotRef.current = null;
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

    const sequence = cloudSaveSequenceRef.current + 1;
    cloudSaveSequenceRef.current = sequence;
    const pendingSnapshot: PendingCloudSnapshot = {
      userId,
      state: createAppStateSnapshot(),
      profile: {
        account: normalizeAccountId(profile.account),
        name: profile.name,
        avatarUrl: getPersistableAvatarUrl(profile),
      },
      baseRevision: cloudConflictRef.current
        ? pendingCloudSnapshotRef.current?.baseRevision ?? cloudRevisionRef.current
        : cloudRevisionRef.current,
      sequence,
      savedAt: Date.now(),
      language,
      baseState: pendingCloudSnapshotRef.current?.baseState || cloudBaseStateRef.current,
    };
    pendingCloudSnapshotRef.current = pendingSnapshot;

    cloudPersistenceChainRef.current = cloudPersistenceChainRef.current
      .catch(() => {})
      .then(async () => {
        await writePendingCloudSnapshot(pendingSnapshot);
        if (pendingCloudSnapshotRef.current?.sequence !== sequence) return;
        setCloudSyncStatus(cloudConflictRef.current ? 'conflict' : 'local', language);
        if (cloudConflictRef.current) return;
        cloudSaveTimerRef.current = window.setTimeout(() => {
          cloudSaveTimerRef.current = null;
          void flushCloudSaveRef.current();
        }, CLOUD_SAVE_DEBOUNCE_MS);
      })
      .catch(error => {
        console.error('Could not persist pending cloud snapshot:', error);
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
