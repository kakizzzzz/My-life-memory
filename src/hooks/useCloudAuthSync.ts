import React from 'react';
import { HOME_COPY } from '../copy/homeCopy';
import { isCloudBackendEnabled } from '../lib/supabaseClient';
import {
  getCloudSession,
  loadCloudAccountData,
  loginCloudAccount,
  onCloudAuthStateChange,
  registerCloudAccount,
  saveCloudAppState,
  saveCloudProfile,
  signOutCloudAccount,
  CloudAuthError,
  type CloudAppState,
  type CloudAuthAction,
  type CloudProfile,
} from '../lib/cloudBackend';
import { normalizePersistedAppState } from '../lib/appStateNormalize';
import { normalizeAccountId } from '../lib/accountUtils';
import {
  getPersistableAvatarUrl,
  getPublicProfileSnapshot,
  isMapStyle,
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
import type {
  AppView,
  HomePanel,
  MapStyle,
  PersistedAppState,
  StarData,
  SystemTheme,
  TrackData,
  UserProfile,
} from '../types/app';

type HomeCopy = typeof HOME_COPY.en;

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
  const isApplyingCloudStateRef = React.useRef(false);
  const cloudReadyToSaveRef = React.useRef(!isCloudBackendEnabled);
  const cloudRegistrationInProgressRef = React.useRef(false);
  const cloudInteractiveAuthInProgressRef = React.useRef(false);
  const hydratingCloudSessionRef = React.useRef<{ userId: string; accessToken: string } | null>(null);
  const hydratedCloudUserIdRef = React.useRef<string | null>(null);
  const cloudSaveTimerRef = React.useRef<number | null>(null);

  const createAppStateSnapshot = React.useCallback((profileOverride?: Partial<UserProfile>): PersistedAppState => {
    const snapshotProfile = {
      ...profile,
      ...profileOverride,
    };

    return {
      mapStyle,
      systemTheme,
      profile: getPublicProfileSnapshot(snapshotProfile),
      isSignedIn: isCloudBackendEnabled ? false : isSignedIn,
      language,
      stars,
      savedTracks,
    };
  }, [isSignedIn, language, mapStyle, profile, savedTracks, stars, systemTheme]);

  const createCleanCloudInitialState = React.useCallback((account: string): PersistedAppState => ({
    mapStyle: 'light',
    systemTheme: DEFAULT_SYSTEM_THEME,
    profile: {
      account,
      name: buildDefaultProfileName(account),
      avatarUrl: '',
    },
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

    if (isMapStyle(remoteState.mapStyle)) setMapStyle(remoteState.mapStyle);
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

  const hydrateCloudSession = React.useCallback(async (session: Awaited<ReturnType<typeof getCloudSession>>) => {
    if (!isCloudBackendEnabled) return;
    if (cloudRegistrationInProgressRef.current) return;
    if (cloudInteractiveAuthInProgressRef.current) return;

    if (!session?.user) {
      hydratingCloudSessionRef.current = null;
      hydratedCloudUserIdRef.current = null;
      cloudReadyToSaveRef.current = false;
      setCloudAuthHydrating(false);
      setIsSignedIn(false);
      setActiveHomePanel(null);
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
      const { profile: cloudProfile, state } = await loadCloudAccountData(session.user);
      applyCloudSnapshot(cloudProfile, state);
      hydratedCloudUserIdRef.current = userId;
    } catch (error) {
      console.error('Could not load cloud account data:', error);
      setLoginError(getCloudAuthErrorMessage(error, 'login'));
      hydratedCloudUserIdRef.current = null;
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
  }, [applyCloudSnapshot, getCloudAuthErrorMessage, setActiveHomePanel, setIsSignedIn]);
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

        applyCloudSnapshot(result.profile, result.state);
      } catch (error) {
        console.error('Cloud login failed:', error);
        cloudReadyToSaveRef.current = false;
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
    if (isCloudBackendEnabled) {
      cloudReadyToSaveRef.current = false;
      hydratingCloudSessionRef.current = null;
      hydratedCloudUserIdRef.current = null;
      setCloudAuthHydrating(false);
      void signOutCloudAccount();
    }
    setActiveHomePanel(null);
    setIsSignedIn(false);
    setLoginAccount('');
    setLoginPassword('');
    setIsPasswordRevealed(false);
    setLoginError('');
  }, [setActiveHomePanel, setIsSignedIn]);

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
    if (!isCloudBackendEnabled || !isSignedIn || !cloudReadyToSaveRef.current || isApplyingCloudStateRef.current) return;

    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }

    const snapshot = createAppStateSnapshot() as CloudAppState;
    const cloudProfile: CloudProfile = {
      account: normalizeAccountId(profile.account),
      name: profile.name,
      avatarUrl: getPersistableAvatarUrl(profile),
    };

    cloudSaveTimerRef.current = window.setTimeout(() => {
      void Promise.all([
        saveCloudProfile(cloudProfile),
        saveCloudAppState(snapshot),
      ]).catch(error => {
        console.error('Could not save cloud app state:', error);
      });
    }, 900);

    return () => {
      if (cloudSaveTimerRef.current !== null) {
        window.clearTimeout(cloudSaveTimerRef.current);
      }
    };
  }, [createAppStateSnapshot, isSignedIn, profile.account, profile.avatarImage, profile.avatarUrl, profile.name]);

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
    handleLogin,
    handleRegister,
    handleSignOut,
    getCloudAuthErrorMessage,
  };
};
