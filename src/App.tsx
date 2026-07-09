import React, { useState, useEffect } from 'react';
import L from 'leaflet';
import { Star } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BottomNavigation,
  GalleryPreviewOverlay,
  InitialPermissionPrompt,
  PasswordChangeModal,
  SearchModal,
} from './AppChrome';
import { NoteEditorModal } from './NoteEditorModal';
import { HomeScreen } from './HomeScreen';
import { MapCanvas } from './MapCanvas';
import { MapControlsOverlay, MapSearchButton, PhotoLocationToast, TrackingControlsOverlay } from './MapControlsOverlay';
import { SearchResultsScreen } from './SearchResultsScreen';
import { RecordsScreen } from './RecordsScreen';
import { ReaderScreen } from './ReaderScreen';
import { TripStatisticsView } from './TripStatisticsView';
import { useMemoryDerivedData } from './hooks/useMemoryDerivedData';
import { useMcpTokens } from './hooks/useMcpTokens';
import { usePasswordChange } from './hooks/usePasswordChange';
import { useGalleryActions } from './hooks/useGalleryActions';
import { usePhotoLocationImport } from './hooks/usePhotoLocationImport';
import { useTrackSummary } from './hooks/useTrackSummary';
import { useReaderController } from './hooks/useReaderController';
import { useMapStarActions } from './hooks/useMapStarActions';
import { useSearchActions } from './hooks/useSearchActions';
import { isCloudBackendEnabled, supabaseConfigMessage } from './lib/supabaseClient';
import {
  buildStorageImageSrc,
  isSupabaseMediaEnabled,
  retryPendingImageDeletions,
  storagePlaceholderSrc,
  warmStorageImageUrls,
  type StoredImageMetadata,
} from './lib/mediaStorage';
import { normalizePersistedAppState } from './lib/appStateNormalize';
import { exportReadableUserData } from './lib/userDataExport';
import {
  dateFromCalendarDateKey,
  formatRecordMonth,
  formatRecordTime,
} from './lib/dateUtils';
import {
  getBearingBetweenPoints,
  getTrackAccuracy,
  ROUTE_DETAIL_DOT_MIN_ZOOM,
  shouldAcceptTrackPoint,
  type TrackPoint,
  type TrackPointMetadata,
} from './lib/trackUtils';
import { createLocationIcon } from './lib/mapMarkerUtils';
import {
  canUseBrowserGeolocation,
  getCompassHeading,
  type DeviceOrientationEventConstructorWithPermission,
  type DeviceOrientationEventWithCompass,
} from './lib/sensorUtils';
import {
  createDefaultRecordStar,
  getNearbyDefaultStarLocation,
  isNearCoordinate,
  normalizeInitialStars,
} from './lib/defaultStarUtils';
import { normalizeAccountId } from './lib/accountUtils';
import {
  clearTrackDraft,
  getPersistableAvatarUrl,
  getPublicProfileSnapshot,
  hasLoginAccount,
  isLanguage,
  isMapStyle,
  markAutoUserManualSeen,
  readAutoUserManualSeen,
  readPersistedAppState,
  readTrackDraft,
  writePersistedAppState,
  writeTrackDraft,
} from './lib/localPersistence';
import {
  getStoredImagesFromNote,
  uniqueStoredImages,
} from './lib/noteHtmlUtils';
import type {
  AppView,
  EditingNoteTarget,
  HomePanel,
  MapStyle,
  PersistedAppState,
  RecordsCalendarMode,
  RecordsFilter,
  SearchField,
  StarData,
  SystemTheme,
  TagMode,
  TrackData,
  UploadedImage,
  UserProfile,
} from './types/app';
import {
  CLOUD_PASSWORD_MIN_LENGTH,
  DEFAULT_PROFILE,
  DEFAULT_RECORD_STAR_ID,
  DEFAULT_RECORD_STAR_LOCATION,
  DEFAULT_USER_LOCATION,
  GEOLOCATION_OPTIONS,
  LEGACY_RECORD_STAR_LOCATION,
  TRACK_STALE_POSITION_GRACE_MS,
} from './constants/appDefaults';
import {
  DEFAULT_NAME_PREFIX,
  LANGUAGE_FONT_FAMILIES,
  LANGUAGE_FONT_SCALE,
  LANGUAGE_LOCALES,
} from './constants/language';
import {
  DEFAULT_SYSTEM_THEME,
} from './constants/theme';
import { MAP_TILES } from './constants/mapTiles';
import {
  MAP_TOOL_ICON_STROKE,
  UI_ICON_STROKE,
} from './constants/ui';
import { HOME_COPY } from './copy/homeCopy';
import {
  getCloudSession,
  loadCloudAccountData,
  loginCloudAccount,
  onCloudAuthStateChange,
  registerCloudAccount,
  saveCloudAppState,
  saveCloudProfile,
  signOutCloudAccount,
  type CloudAuthAction,
  CloudAuthError,
  type CloudAppState,
  type CloudProfile,
} from './lib/cloudBackend';

export default function App() {
  const [persistedAppState] = useState<PersistedAppState | null>(() => readPersistedAppState());
  const canUseLocalAuthFallback = import.meta.env.DEV && !isCloudBackendEnabled;
  const persistedPrivateState = canUseLocalAuthFallback ? persistedAppState : null;
  const initialLanguage = isLanguage(persistedAppState?.language) ? persistedAppState.language : 'en';
  const persistedAccount = normalizeAccountId(persistedPrivateState?.profile?.account || '');
  const initialProfile: UserProfile = {
    ...DEFAULT_PROFILE,
    ...(persistedPrivateState?.profile || {}),
    name: (persistedPrivateState?.profile?.name || '').trim()
      || (persistedAccount ? `${DEFAULT_NAME_PREFIX[initialLanguage]}${persistedAccount}` : DEFAULT_NAME_PREFIX[initialLanguage].trim()),
    password: DEFAULT_PROFILE.password,
  };
  const initialSignedIn = (
    canUseLocalAuthFallback &&
    persistedAppState?.isSignedIn === true &&
    hasLoginAccount(initialProfile)
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => (
    isMapStyle(persistedAppState?.mapStyle) ? persistedAppState.mapStyle : 'light'
  ));
  const [isMapStyleMenuOpen, setIsMapStyleMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>(() => initialSignedIn ? 'map' : 'home');
  const [activeHomePanel, setActiveHomePanel] = useState<HomePanel>(null);
  const [isInitialPermissionPromptOpen, setIsInitialPermissionPromptOpen] = useState(false);
  const [hasSeenInitialPermissionPrompt, setHasSeenInitialPermissionPrompt] = useState(false);
  const [recordsFilter, setRecordsFilter] = useState<RecordsFilter>('all');
  const [selectedRecordsDateKey, setSelectedRecordsDateKey] = useState<string | null>(null);
  const [isRecordsMenuOpen, setIsRecordsMenuOpen] = useState(false);
  const [isRecordsCalendarOpen, setIsRecordsCalendarOpen] = useState(false);
  const [recordsCalendarDate, setRecordsCalendarDate] = useState(new Date());
  const [recordsCalendarMode, setRecordsCalendarMode] = useState<RecordsCalendarMode>('month');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeSearchField, setActiveSearchField] = useState<SearchField>('text');
  const [coordinateSearch, setCoordinateSearch] = useState('');
  const [textSearch, setTextSearch] = useState('');
  const [submittedTextSearch, setSubmittedTextSearch] = useState('');
  const [searchReturnView, setSearchReturnView] = useState<'map' | 'records'>('records');
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(() => ({
    ...DEFAULT_SYSTEM_THEME,
    ...(persistedAppState?.systemTheme || {}),
  }));
  const [activeThemeColorKey, setActiveThemeColorKey] = useState<keyof SystemTheme | null>(null);
  const [showThemeCustomPicker, setShowThemeCustomPicker] = useState(false);
  const [galleryPreviewImage, setGalleryPreviewImage] = useState<UploadedImage | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => initialProfile);
  const [isSignedIn, setIsSignedIn] = useState(initialSignedIn);
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
  const [authMode, setAuthMode] = useState<CloudAuthAction>('login');
  const [loginAccount, setLoginAccount] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [registerInviteCode, setRegisterInviteCode] = useState('');
  const [isPasswordRevealed, setIsPasswordRevealed] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isExportingData, setIsExportingData] = useState(false);
  const [exportDataStatus, setExportDataStatus] = useState('');
  const [isPasswordChangeOpen, setIsPasswordChangeOpen] = useState(false);
  const [permissionRequestState, setPermissionRequestState] = useState<'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported'>('idle');
  const [language, setLanguage] = useState(() => (
    initialLanguage
  ));
  const buildDefaultProfileName = React.useCallback((account: string) => {
    const normalizedAccount = normalizeAccountId(account);
    const lang = isLanguage(language) ? language : 'zh';
    const prefix = DEFAULT_NAME_PREFIX[lang];
    return normalizedAccount ? `${prefix}${normalizedAccount}` : prefix.trim();
  }, [language]);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);
  const photoLocationInputRef = React.useRef<HTMLInputElement>(null);
  const homeScrollRef = React.useRef<HTMLDivElement>(null);

  const position: [number, number] = DEFAULT_USER_LOCATION;
  
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_USER_LOCATION);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [deviceHeading, setDeviceHeading] = useState(0);
  const [isWatchingUserLocation, setIsWatchingUserLocation] = useState(false);
  const [stars, setStars] = useState<StarData[]>(() => (
    normalizeInitialStars(persistedPrivateState?.stars) || [createDefaultRecordStar()]
  ));
  const [selectedStarId, setSelectedStarId] = useState<string | null>(null);
  const [editingNoteTarget, setEditingNoteTarget] = useState<EditingNoteTarget | null>(null);

  const cloudConfigError = !isCloudBackendEnabled && !canUseLocalAuthFallback ? supabaseConfigMessage : '';
  
  // Tag Mode State
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagMode, setTagMode] = useState<TagMode>('none');
  const [activeTag, setActiveTag] = useState<{ order: number, groupId: number } | null>(null);
  const [currentTagGroupId, setCurrentTagGroupId] = useState<number>(0);

  // Tracking Mode State
  const [isTracking, setIsTracking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [trackPaths, setTrackPaths] = useState<[number, number][][]>([]);
  const [trackTime, setTrackTime] = useState(0);
  const [savedTracks, setSavedTracks] = useState<TrackData[]>(() => (
    Array.isArray(persistedPrivateState?.savedTracks) ? persistedPrivateState.savedTracks : []
  ));
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedTrackLatLng, setSelectedTrackLatLng] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState(16);

  const isLocating = React.useRef(false);
  const gpsWatchIdRef = React.useRef<number | null>(null);
  const headingWatchCleanupRef = React.useRef<(() => void) | null>(null);
  const lastGpsLocationRef = React.useRef<[number, number] | null>(null);
  const lastTrackPointRef = React.useRef<TrackPoint | null>(null);
  const trackingStartedAtRef = React.useRef(0);
  const lastCompassHeadingAtRef = React.useRef(0);
  const isRequestingHeadingPermissionRef = React.useRef(false);
  const hasSyncedDefaultStarToGpsRef = React.useRef(false);
  const isApplyingCloudStateRef = React.useRef(false);
  const cloudReadyToSaveRef = React.useRef(!isCloudBackendEnabled);
  const cloudRegistrationInProgressRef = React.useRef(false);
  const cloudSaveTimerRef = React.useRef<number | null>(null);
  const hasRequestedEntryLocationRef = React.useRef(false);
  const autoOpenedManualAccountRef = React.useRef<string | null>(null);
  const checkedTrackDraftAccountRef = React.useRef<string | null>(null);
  const trackingStateRef = React.useRef({ isTracking, isPaused });
  const trackDraftStateRef = React.useRef({ paths: trackPaths, time: trackTime });
  useEffect(() => {
    trackingStateRef.current = { isTracking, isPaused };
  }, [isTracking, isPaused]);

  useEffect(() => {
    trackDraftStateRef.current = { paths: trackPaths, time: trackTime };
  }, [trackPaths, trackTime]);

  const appendTrackPoint = React.useCallback((
    newLoc: [number, number],
    metadata: TrackPointMetadata = {}
  ) => {
    const accuracy = getTrackAccuracy(metadata.accuracy);
    const timestamp = Number.isFinite(metadata.timestamp) ? metadata.timestamp as number : Date.now();
    const previousAcceptedPoint = lastTrackPointRef.current;
    const nextPoint: TrackPoint = { location: newLoc, timestamp, accuracy };

    if (
      trackingStartedAtRef.current > 0 &&
      timestamp < trackingStartedAtRef.current - TRACK_STALE_POSITION_GRACE_MS
    ) {
      return;
    }

    const startNewSegment = () => {
      setTrackPaths(prev => {
        if (prev.length === 0) return [[newLoc]];
        const newPaths = [...prev];
        const lastIndex = newPaths.length - 1;
        const currentSegment = newPaths[lastIndex];
        if (currentSegment.length === 0) {
          newPaths[lastIndex] = [newLoc];
          return newPaths;
        }
        if (currentSegment.length === 1) {
          newPaths[lastIndex] = [newLoc];
          return newPaths;
        }
        return [...newPaths, [newLoc]];
      });
      lastTrackPointRef.current = nextPoint;
    };

    const decision = shouldAcceptTrackPoint(previousAcceptedPoint, nextPoint, metadata);

    if (decision.action === 'reject') {
      return;
    }

    if (decision.action === 'segment') {
      startNewSegment();
      return;
    }

    setTrackPaths(prev => {
      if (prev.length === 0) return [[newLoc]];

      const newPaths = [...prev];
      const lastIndex = newPaths.length - 1;
      const currentSegment = [...newPaths[lastIndex]];
      const lastPoint = currentSegment[currentSegment.length - 1];

      if (lastPoint && L.latLng(lastPoint).distanceTo(L.latLng(newLoc)) < 0.75) {
        return prev;
      }

      currentSegment.push(newLoc);
      newPaths[lastIndex] = currentSegment;
      return newPaths;
    });
    lastTrackPointRef.current = nextPoint;
  }, []);

  const syncDefaultStarNearUser = React.useCallback((newLoc: [number, number], force = false) => {
    if (!force && hasSyncedDefaultStarToGpsRef.current) return;

    let didChange = false;
    setStars(prev => {
      let changed = false;
      const next = prev.map(star => {
        if (star.id !== DEFAULT_RECORD_STAR_ID) return star;

        const isUntouchedDefault =
          isNearCoordinate(star.lat, star.lng, DEFAULT_RECORD_STAR_LOCATION) ||
          isNearCoordinate(star.lat, star.lng, LEGACY_RECORD_STAR_LOCATION);

        if (!isUntouchedDefault) return star;

        changed = true;
        didChange = true;
        const [lat, lng] = getNearbyDefaultStarLocation(newLoc);
        return { ...star, lat, lng };
      });

      return changed ? next : prev;
    });

    if (force || didChange) {
      hasSyncedDefaultStarToGpsRef.current = true;
    }
  }, []);

  const applyLocationPoint = React.useCallback((newLoc: [number, number], shouldFly = false, heading?: number | null) => {
    const previousLoc = lastGpsLocationRef.current;
    const hasRecentCompassHeading = Date.now() - lastCompassHeadingAtRef.current < 2500;
    setUserLocation(newLoc);
    if (!hasRecentCompassHeading && typeof heading === 'number' && Number.isFinite(heading)) {
      setDeviceHeading((heading + 360) % 360);
    } else if (!hasRecentCompassHeading && previousLoc && L.latLng(previousLoc).distanceTo(L.latLng(newLoc)) >= 1) {
      setDeviceHeading(getBearingBetweenPoints(previousLoc, newLoc));
    }
    lastGpsLocationRef.current = newLoc;
    if (shouldFly) setFlyTarget(newLoc);

  }, []);

  const applyGpsPosition = React.useCallback((position: GeolocationPosition, shouldFly = false) => {
    const newLoc: [number, number] = [position.coords.latitude, position.coords.longitude];
    const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined;
    const gpsHeading = (
      typeof position.coords.heading === 'number' &&
      Number.isFinite(position.coords.heading) &&
      typeof position.coords.speed === 'number' &&
      position.coords.speed > 0.5
    ) ? position.coords.heading : null;
    syncDefaultStarNearUser(newLoc);
    applyLocationPoint(
      newLoc,
      shouldFly,
      gpsHeading
    );
    if (trackingStateRef.current.isTracking && !trackingStateRef.current.isPaused) {
      appendTrackPoint(newLoc, {
        accuracy,
        timestamp: position.timestamp,
        speed: position.coords.speed,
      });
    }
  }, [appendTrackPoint, applyLocationPoint, syncDefaultStarNearUser]);

  const stopGpsWatch = React.useCallback(() => {
    if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }
    gpsWatchIdRef.current = null;
  }, []);

  const stopHeadingWatch = React.useCallback(() => {
    headingWatchCleanupRef.current?.();
    headingWatchCleanupRef.current = null;
  }, []);

  const startHeadingWatch = React.useCallback(async (requestPermission = true) => {
    if (headingWatchCleanupRef.current || typeof window === 'undefined') return;
    if (isRequestingHeadingPermissionRef.current) return;

    const orientationEvent = window.DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission | undefined;
    if (!orientationEvent) return;

    isRequestingHeadingPermissionRef.current = true;
    try {
      if (typeof orientationEvent.requestPermission === 'function') {
        if (!requestPermission) return;
        const permission = await orientationEvent.requestPermission(true);
        if (permission !== 'granted') return;
      }
    } catch {
      return;
    } finally {
      isRequestingHeadingPermissionRef.current = false;
    }

    const handleOrientation = (event: Event) => {
      const heading = getCompassHeading(event as DeviceOrientationEventWithCompass);
      if (heading !== null) {
        lastCompassHeadingAtRef.current = Date.now();
        setDeviceHeading(heading);
      }
    };

    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    headingWatchCleanupRef.current = () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  const requestUserLocation = React.useCallback((shouldFly = false) => {
    if (!canUseBrowserGeolocation()) {
      if (shouldFly) setFlyTarget([userLocation[0], userLocation[1]]);
      return false;
    }

    setIsWatchingUserLocation(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        applyGpsPosition(position, shouldFly);
        isLocating.current = false;
      },
      error => {
        if (shouldFly) setFlyTarget([userLocation[0], userLocation[1]]);
        if (error.code === error.PERMISSION_DENIED && !trackingStateRef.current.isTracking) {
          setIsWatchingUserLocation(false);
        }
        isLocating.current = false;
      },
      GEOLOCATION_OPTIONS
    );
    return true;
  }, [applyGpsPosition, userLocation]);

  const requestLocationPermissionOnce = React.useCallback(() => new Promise<boolean>(resolve => {
    if (!canUseBrowserGeolocation()) {
      resolve(false);
      return;
    }

    setIsWatchingUserLocation(true);
    navigator.geolocation.getCurrentPosition(
      position => {
        applyGpsPosition(position, false);
        resolve(true);
      },
      error => {
        if (error.code === error.PERMISSION_DENIED && !trackingStateRef.current.isTracking) {
          setIsWatchingUserLocation(false);
        }
        resolve(false);
      },
      GEOLOCATION_OPTIONS
    );
  }), [applyGpsPosition]);

  const handleOpenPermissions = React.useCallback(async () => {
    if (typeof window === 'undefined') return;

    setHasSeenInitialPermissionPrompt(true);
    setIsInitialPermissionPromptOpen(false);

    const canRequestLocation = canUseBrowserGeolocation();
    const canRequestHeading = Boolean(window.DeviceOrientationEvent);

    if (!canRequestLocation && !canRequestHeading) {
      setPermissionRequestState('unsupported');
      return;
    }

    setPermissionRequestState('requesting');
    const headingRequest = canRequestHeading
      ? startHeadingWatch(true).then(() => Boolean(headingWatchCleanupRef.current)).catch(() => false)
      : Promise.resolve(false);
    const locationRequest = canRequestLocation
      ? requestLocationPermissionOnce()
      : Promise.resolve(false);

    const [headingReady, locationReady] = await Promise.all([headingRequest, locationRequest]);
    setPermissionRequestState(headingReady || locationReady ? 'ready' : 'denied');
  }, [requestLocationPermissionOnce, startHeadingWatch]);

  const closeInitialPermissionPrompt = React.useCallback(() => {
    setHasSeenInitialPermissionPrompt(true);
    setIsInitialPermissionPromptOpen(false);
  }, []);

  const handleInitialPermissionRequest = React.useCallback(async () => {
    closeInitialPermissionPrompt();
    await handleOpenPermissions();
    if (lastGpsLocationRef.current) {
      setFlyTarget(lastGpsLocationRef.current);
    }
  }, [closeInitialPermissionPrompt, handleOpenPermissions]);

  useEffect(() => {
    if (!isSignedIn || activeView !== 'map' || hasRequestedEntryLocationRef.current) return;
    hasRequestedEntryLocationRef.current = true;

    if (!hasSeenInitialPermissionPrompt && permissionRequestState !== 'ready') {
      setIsInitialPermissionPromptOpen(true);
      return;
    }

    if (!canUseBrowserGeolocation()) {
      setPermissionRequestState('unsupported');
      return;
    }

    let isCancelled = false;
    setPermissionRequestState('requesting');
    requestLocationPermissionOnce().then(locationReady => {
      if (isCancelled) return;
      setPermissionRequestState(locationReady ? 'ready' : 'denied');
      if (locationReady && lastGpsLocationRef.current) {
        setFlyTarget(lastGpsLocationRef.current);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [activeView, hasSeenInitialPermissionPrompt, isSignedIn, permissionRequestState, requestLocationPermissionOnce]);

  useEffect(() => {
    if (!isSignedIn) return;
    const account = normalizeAccountId(profile.account);
    if (!account || autoOpenedManualAccountRef.current === account) return;

    autoOpenedManualAccountRef.current = account;
    if (readAutoUserManualSeen(account)) return;

    markAutoUserManualSeen(account);
    setActiveView('home');
    setActiveHomePanel('manual');
  }, [isSignedIn, profile.account]);

  useEffect(() => {
    if (activeHomePanel !== 'theme') {
      setActiveThemeColorKey(null);
      setShowThemeCustomPicker(false);
    }
    if (activeHomePanel !== 'profile') {
      setIsPasswordChangeOpen(false);
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setPasswordChangeStatus('');
    }
  }, [activeHomePanel]);

  useEffect(() => {
    if (activeView !== 'records') {
      setIsRecordsMenuOpen(false);
      setIsRecordsCalendarOpen(false);
    }
    if (activeView === 'home' || activeView === 'stats' || activeView === 'searchResults') {
      setIsSearchOpen(false);
    }
    if (activeView !== 'reader') {
      setIsReaderToolsOpen(false);
      setReaderActivePanel(null);
      setReaderShowCustomPicker(false);
    }
  }, [activeView]);

  useEffect(() => {
    if (isSignedIn) return;
    hasRequestedEntryLocationRef.current = false;
    autoOpenedManualAccountRef.current = null;
    checkedTrackDraftAccountRef.current = null;
    hasSyncedDefaultStarToGpsRef.current = false;
    setHasSeenInitialPermissionPrompt(false);
    setActiveView('home');
    setActiveHomePanel(null);
    setIsInitialPermissionPromptOpen(false);
    setIsMenuOpen(false);
    setIsMapStyleMenuOpen(false);
    setTagMenuOpen(false);
    setIsSearchOpen(false);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
    setReadingNoteTarget(null);
    setEditingNoteTarget(null);
  }, [isSignedIn]);

  useEffect(() => {
    if (isCloudBackendEnabled) {
      writePersistedAppState({
        mapStyle,
        systemTheme,
        isSignedIn: false,
        language,
      });
      return;
    }

    writePersistedAppState({
      mapStyle,
      systemTheme,
      profile: getPublicProfileSnapshot(profile),
      isSignedIn,
      language,
      stars,
      savedTracks,
    });
  }, [isSignedIn, language, mapStyle, profile, savedTracks, stars, systemTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as typeof window & {
      __MAP_APP_SENSOR_DEBUG__?: Record<string, unknown>;
    }).__MAP_APP_SENSOR_DEBUG__ = {
      userLocation,
      deviceHeading,
      isWatchingUserLocation,
      isTracking,
      hasGpsWatch: gpsWatchIdRef.current !== null,
      isSecureContext: window.isSecureContext,
      hasGeolocation: canUseBrowserGeolocation(),
      hasDeviceOrientation: Boolean(window.DeviceOrientationEvent),
      hasDeviceOrientationPermission: Boolean(
        (window.DeviceOrientationEvent as DeviceOrientationEventConstructorWithPermission | undefined)?.requestPermission
      ),
      lastCompassHeadingAgeMs: lastCompassHeadingAtRef.current
        ? Date.now() - lastCompassHeadingAtRef.current
        : null,
    };
  }, [deviceHeading, isTracking, isWatchingUserLocation, userLocation]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTracking && !isPaused) {
      interval = setInterval(() => {
        setTrackTime(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTracking, isPaused]);

  useEffect(() => {
    if (!isSignedIn || isTracking) return;
    const account = normalizeAccountId(profile.account);
    if (!account || checkedTrackDraftAccountRef.current === account) return;
    checkedTrackDraftAccountRef.current = account;

    const draft = readTrackDraft(account);
    if (!draft) return;

    const restorePrompt = (HOME_COPY[language as keyof typeof HOME_COPY] || HOME_COPY.en).restoreTrackDraft;
    if (window.confirm(restorePrompt)) {
      setTrackPaths(draft.paths);
      setTrackTime(draft.time);
      setIsTracking(true);
      setIsPaused(true);
      trackingStateRef.current = { isTracking: true, isPaused: true };
      lastTrackPointRef.current = null;
      trackingStartedAtRef.current = Date.now();
      setActiveView('map');
      setActiveHomePanel(null);
    } else {
      clearTrackDraft(account);
    }
  }, [isSignedIn, isTracking, language, profile.account]);

  useEffect(() => {
    if (!isSignedIn || !isTracking) return;
    const account = normalizeAccountId(profile.account);
    if (!account) return;

    const saveDraft = () => {
      const paths = trackDraftStateRef.current.paths.filter(path => path.length > 0);
      if (paths.length === 0) return;
      writeTrackDraft(account, {
        paths,
        time: trackDraftStateRef.current.time,
        savedAt: Date.now(),
      });
    };

    saveDraft();
    const interval = window.setInterval(saveDraft, 4000);
    return () => window.clearInterval(interval);
  }, [isSignedIn, isTracking, profile.account]);

  useEffect(() => {
    const shouldWatchLocation = isWatchingUserLocation || isTracking;

    if (!shouldWatchLocation || !canUseBrowserGeolocation()) {
      stopGpsWatch();
      return;
    }

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      position => applyGpsPosition(position),
      error => {
        if (error.code !== error.PERMISSION_DENIED) return;
        stopGpsWatch();
        if (!trackingStateRef.current.isTracking) {
          setIsWatchingUserLocation(false);
        }
      },
      GEOLOCATION_OPTIONS
    );

    return stopGpsWatch;
  }, [applyGpsPosition, isTracking, isWatchingUserLocation, stopGpsWatch]);

  useEffect(() => () => {
    stopGpsWatch();
    stopHeadingWatch();
  }, [stopGpsWatch, stopHeadingWatch]);

  const { trackDistanceKm, activeTrackDistanceDisplay, formatTime } = useTrackSummary(trackPaths);
  const {
    starDragPreview,
    onMapClick,
    handleLocateMe,
    handleMapReady,
    addStarAtLatLng,
    addStarAtUserLocation,
    handleStarPlacementPointerDown,
    handleStarPlacementPointerMove,
    finishStarPlacementPointer,
    cancelStarPlacementPointer,
    handleMapDrop,
    onStarClick,
    onUpdateStar,
    onMoveStar,
    onDeleteStar,
    toggleTagMenu,
    handlePrevTag,
    handleNextTag,
  } = useMapStarActions({
    userLocation,
    stars,
    setStars,
    selectedStarId,
    setSelectedStarId,
    setSelectedTrackId,
    setSelectedTrackLatLng,
    setFlyTarget,
    tagMode,
    setTagMode,
    tagMenuOpen,
    setTagMenuOpen,
    activeTag,
    setActiveTag,
    currentTagGroupId,
    setCurrentTagGroupId,
    setMapZoom,
  });

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
    hasSyncedDefaultStarToGpsRef.current = false;

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
    if (lastGpsLocationRef.current) {
      syncDefaultStarNearUser(lastGpsLocationRef.current, true);
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
  }, [buildDefaultProfileName, syncDefaultStarNearUser]);

  const hydrateCloudSession = React.useCallback(async (session: Awaited<ReturnType<typeof getCloudSession>>) => {
    if (!isCloudBackendEnabled) return;
    if (cloudRegistrationInProgressRef.current) return;

    if (!session?.user) {
      cloudReadyToSaveRef.current = false;
      setIsSignedIn(false);
      setActiveHomePanel(null);
      return;
    }

    try {
      const { profile: cloudProfile, state } = await loadCloudAccountData(session.user);
      applyCloudSnapshot(cloudProfile, state);
    } catch (error) {
      console.error('Could not load cloud account data:', error);
      setLoginError(getCloudAuthErrorMessage(error, 'login'));
      cloudReadyToSaveRef.current = false;
      setIsSignedIn(false);
      setActiveHomePanel(null);
      void signOutCloudAccount();
    }
  }, [applyCloudSnapshot]);
  const hydrateCloudSessionRef = React.useRef(hydrateCloudSession);

  useEffect(() => {
    hydrateCloudSessionRef.current = hydrateCloudSession;
  }, [hydrateCloudSession]);

  const getCloudAuthErrorMessage = (error: unknown, action: CloudAuthAction) => {
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
  };

  const buildCloudAuthPayload = React.useCallback((enteredAccount: string, enteredPassword = '') => {
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

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
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

      try {
        const {
          normalizedAccount,
          initialProfileForCloud,
          initialState,
        } = buildCloudAuthPayload(enteredAccount, loginPassword);
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
  };

  const handleRegister = async (event?: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) => {
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
      } = buildCloudAuthPayload(enteredAccount, loginPassword);
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
  };

  const handleSignOut = () => {
    if (isCloudBackendEnabled) {
      cloudReadyToSaveRef.current = false;
      void signOutCloudAccount();
    }
    setActiveHomePanel(null);
    setIsSignedIn(false);
    setLoginAccount('');
    setLoginPassword('');
    setIsPasswordRevealed(false);
    setLoginError('');
  };

  const getReferencedStoredMedia = React.useCallback(() => (
    uniqueStoredImages([
      profile.avatarImage,
      ...stars.flatMap(star => (
        (star.notes || []).flatMap(note => getStoredImagesFromNote(note))
      )),
    ].filter((metadata): metadata is StoredImageMetadata => Boolean(metadata)))
  ), [profile.avatarImage, stars]);

  useEffect(() => {
    if (!isSupabaseMediaEnabled || !isSignedIn) return;

    let isMounted = true;
    const metadataList = getReferencedStoredMedia();

    void warmStorageImageUrls(metadataList).then(() => {
      if (isMounted) setMediaRefreshKey(key => key + 1);
    });

    return () => {
      isMounted = false;
    };
  }, [getReferencedStoredMedia, isSignedIn, profile.account]);

  useEffect(() => {
    if (!isSupabaseMediaEnabled || !isSignedIn) return;

    const retryDeletes = () => {
      void retryPendingImageDeletions();
    };

    retryDeletes();
    window.addEventListener('online', retryDeletes);
    window.addEventListener('focus', retryDeletes);

    return () => {
      window.removeEventListener('online', retryDeletes);
      window.removeEventListener('focus', retryDeletes);
    };
  }, [isSignedIn, profile.account]);

  useEffect(() => {
    if (!isCloudBackendEnabled) return;

    let isMounted = true;
    void getCloudSession().then(session => {
      if (!isMounted) return;
      void hydrateCloudSessionRef.current(session);
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

  useEffect(() => {
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

  const closeHomePanel = React.useCallback(() => {
    if (homeScrollRef.current) {
      homeScrollRef.current.scrollTop = 0;
      homeScrollRef.current.scrollLeft = 0;
    }
    setActiveHomePanel(current => (
      current === 'language' ||
      current === 'permissions' ||
      current === 'manual' ||
      current === 'apiSecurity' ||
      current === 'mcp' ||
      current === 'export'
        ? 'settings'
        : null
    ));
  }, []);

  const openRecordsCalendarPanel = () => {
    setRecordsCalendarDate(dateFromCalendarDateKey(selectedRecordsDateKey) || new Date());
    setRecordsCalendarMode('month');
    setIsRecordsCalendarOpen(true);
    setIsRecordsMenuOpen(false);
    setIsSearchOpen(false);
  };

  const tagPolylines = React.useMemo(() => {
    const groups = new Map<number, StarData[]>();
    stars.filter(s => s.tagOrder !== undefined && s.tagGroupId !== undefined).forEach(s => {
      if (!groups.has(s.tagGroupId!)) groups.set(s.tagGroupId!, []);
      groups.get(s.tagGroupId!)!.push(s);
    });

    const result: { groupId: number, color: string, positions: [number, number][] }[] = [];
    groups.forEach((groupStars, groupId) => {
      groupStars.sort((a, b) => a.tagOrder! - b.tagOrder!);
      result.push({
        groupId,
        color: mapStyle === 'aerial' ? '#ffffff' : systemTheme.icon,
        positions: groupStars.map(s => [s.lat, s.lng] as [number, number])
      });
    });
    return result;
  }, [stars, mapStyle, systemTheme.icon]);

  const onUpdateTrack = (id: string, updates: Partial<TrackData>) => {
    setSavedTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const onDeleteTrack = (id: string) => {
    setSavedTracks(prev => prev.filter(t => t.id !== id));
    if (selectedTrackId === id) {
      setSelectedTrackId(null);
      setSelectedTrackLatLng(null);
    }
  };

  const homeCopy = HOME_COPY[language as keyof typeof HOME_COPY] || HOME_COPY.en;
  const languageLocale = LANGUAGE_LOCALES[language] || LANGUAGE_LOCALES.en;
  const selectedFontFamily = LANGUAGE_FONT_FAMILIES[language] || LANGUAGE_FONT_FAMILIES.en;
  const selectedFontScale = LANGUAGE_FONT_SCALE[language] || LANGUAGE_FONT_SCALE.en;
  const {
    currentPasswordInput,
    newPasswordInput,
    confirmPasswordInput,
    isChangingPassword,
    passwordChangeStatus,
    setCurrentPasswordInput,
    setNewPasswordInput,
    setConfirmPasswordInput,
    setPasswordChangeStatus,
    handleChangePassword,
  } = usePasswordChange({
    account: profile.account,
    minPasswordLength: CLOUD_PASSWORD_MIN_LENGTH,
    copy: {
      loginMissing: homeCopy.loginMissing,
      passwordTooShort: homeCopy.passwordTooShort,
      passwordMismatch: homeCopy.passwordMismatch,
      passwordChanged: homeCopy.passwordChanged,
      currentPasswordWrong: homeCopy.currentPasswordWrong,
    },
    getFallbackErrorMessage: error => getCloudAuthErrorMessage(error, 'login'),
    onChanged: () => setIsPasswordChangeOpen(false),
  });
  const {
    mcpTokens,
    mcpPlainToken,
    mcpTokenStatus,
    isMcpTokenBusy,
    handleCreateMcpToken,
    handleCopyMcpText,
    handleRevokeMcpToken,
  } = useMcpTokens({
    isSignedIn,
    activeHomePanel,
    account: profile.account,
    copy: {
      mcpFailed: homeCopy.mcpFailed,
      mcpTokenReady: homeCopy.mcpTokenReady,
      mcpCopied: homeCopy.mcpCopied,
      mcpRevoked: homeCopy.mcpRevoked,
    },
  });
  const permissionStatusText = (
    permissionRequestState === 'requesting' ? homeCopy.permissionRequesting :
    permissionRequestState === 'ready' ? '' :
    permissionRequestState === 'denied' ? homeCopy.permissionDenied :
    permissionRequestState === 'unsupported' ? homeCopy.permissionUnsupported :
    ''
  );
  const isOriginalSystemTheme = (Object.keys(DEFAULT_SYSTEM_THEME) as (keyof SystemTheme)[]).every(
    key => systemTheme[key].toLowerCase() === DEFAULT_SYSTEM_THEME[key].toLowerCase()
  );
  const appThemeVars = {
    '--app-page': systemTheme.page,
    '--app-card': systemTheme.card,
    '--app-icon': systemTheme.icon,
    '--app-dark': systemTheme.dark,
    '--app-active-surface': isOriginalSystemTheme ? '#ffffff' : `color-mix(in srgb, ${systemTheme.page} 58%, white)`,
    '--app-card-surface': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.8)' : `color-mix(in srgb, ${systemTheme.card} 68%, white)`,
    '--app-nav-surface': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.95)' : `color-mix(in srgb, ${systemTheme.page} 76%, white)`,
    '--app-soft-surface': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.55)' : `color-mix(in srgb, ${systemTheme.page} 62%, white)`,
    '--app-soft-card': isOriginalSystemTheme ? 'rgba(255, 255, 255, 0.6)' : `color-mix(in srgb, ${systemTheme.card} 56%, white)`,
    '--font-sans': selectedFontFamily,
    '--font-mono': selectedFontFamily,
    '--app-font-scale': selectedFontScale,
  } as React.CSSProperties;

  const profileAvatarSrc = React.useMemo(() => (
    profile.avatarImage
      ? buildStorageImageSrc(profile.avatarImage) || storagePlaceholderSrc(profile.avatarImage)
      : profile.avatarUrl
  ), [mediaRefreshKey, profile.avatarImage, profile.avatarUrl]);

  const {
    uploadedImages,
    recordsByDate,
    searchResultRecords,
    recordDateKeys,
    calendarActivityDateKeys,
    mapActivity,
    markedLocationCount,
    starRecordRankings,
    recordsCalendarDays,
    recordsCalendarEmptyDays,
    recordsCalendarMonths,
  } = useMemoryDerivedData({
    stars,
    savedTracks,
    isTracking,
    trackPaths,
    recordsFilter,
    selectedRecordsDateKey,
    submittedTextSearch,
    recordsCalendarDate,
    mediaRefreshKey,
    copy: {
      noteLabel: homeCopy.noteLabel,
      starLabel: homeCopy.starLabel,
      untitledNote: homeCopy.untitledNote,
    },
  });
  const {
    handleAvatarInput,
    downloadGalleryImage,
  } = useGalleryActions({
    profile,
    setProfile,
  });
  const handlePhotoLocationCreated = React.useCallback((starId: string, coordinates: [number, number]) => {
    setSelectedStarId(starId);
    setActiveTag(null);
    setFlyTarget(coordinates);
    setIsMenuOpen(false);
  }, []);
  const {
    isReadingPhotoLocation,
    photoLocationStatus,
    handlePhotoLocationInput,
  } = usePhotoLocationImport({
    copy: {
      photoLocationLoading: homeCopy.photoLocationLoading,
      photoLocationNoGps: homeCopy.photoLocationNoGps,
      photoGpsNoteTitle: homeCopy.photoGpsNoteTitle,
      noteImageAlt: homeCopy.noteImageAlt,
      removeImage: homeCopy.removeImage,
      photoLocationCreated: homeCopy.photoLocationCreated,
      photoLocationFailed: homeCopy.photoLocationFailed,
    },
    addStarAtLatLng,
    onCreated: handlePhotoLocationCreated,
  });
  const {
    setReadingNoteTarget,
    readerCameraInputRef,
    readerImageInputRef,
    readerTitleRef,
    readerContentRef,
    isReaderToolsOpen,
    setIsReaderToolsOpen,
    readerActivePanel,
    setReaderActivePanel,
    readerSelectedFontSize,
    readerSelectedColor,
    readerSelectedUnderline,
    readerShowCustomPicker,
    setReaderShowCustomPicker,
    readerRecord,
    saveReaderDraft,
    saveReaderSelection,
    openReaderFromRecord,
    locateReaderRecord,
    keepReaderSelectionPointerDown,
    handleReaderFontSize,
    handleReaderTextColor,
    handleReaderUnderline,
    handleReaderBeforeInput,
    handleReaderInput,
    handleReaderContentClick,
    handleReaderPaste,
    handleReaderImageInput,
    handleReaderPanelToggle,
  } = useReaderController({
    activeView,
    stars,
    setStars,
    setActiveView,
    setActiveHomePanel,
    setIsRecordsMenuOpen,
    setIsRecordsCalendarOpen,
    setIsSearchOpen,
    setSubmittedTextSearch,
    setFlyTarget,
    setSelectedStarId,
    setActiveTag,
    homeCopy,
    mediaRefreshKey,
  });

  const {
    handleCoordinateSearch,
    handleTextSearch,
    openSearchModal,
    closeSearchModal,
    closeSearchResults,
  } = useSearchActions({
    coordinateSearch,
    textSearch,
    activeView,
    searchReturnView,
    setFlyTarget,
    setActiveView,
    setActiveHomePanel,
    setIsSearchOpen,
    setIsRecordsMenuOpen,
    setIsRecordsCalendarOpen,
    setSelectedRecordsDateKey,
    setActiveSearchField,
    setSearchReturnView,
    setSubmittedTextSearch,
    setIsMenuOpen,
    setIsMapStyleMenuOpen,
    setTagMenuOpen,
  });

  const updateThemeColor = (key: keyof SystemTheme, value: string) => {
    setSystemTheme(prev => ({ ...prev, [key]: value }));
  };

  const handleExportUserData = async () => {
    if (isExportingData) return;

    setIsExportingData(true);
    setExportDataStatus('');

    try {
      const result = await exportReadableUserData({
        stars,
        profile,
        languageLocale,
        copy: {
          noteLabel: homeCopy.noteLabel,
        },
      });
      setExportDataStatus(result.hasImageError ? homeCopy.exportDataPartial : homeCopy.exportDataReady);
    } catch (error) {
      console.error('Could not export user data:', error);
      setExportDataStatus(homeCopy.exportDataFailed);
    } finally {
      setIsExportingData(false);
    }
  };

  const screenTopPaddingClass = 'pt-16';
  const btnClass = "w-12 h-12 rounded-full bg-[var(--app-icon)] flex items-center justify-center text-black hover:brightness-95 transition-all shadow-sm";
  const starPlacementButtonClass = `${btnClass} touch-none`;

  const startTrackingRoute = () => {
    clearTrackDraft(profile.account);
    void startHeadingWatch();
    const startedAt = Date.now();
    trackingStartedAtRef.current = startedAt;
    lastTrackPointRef.current = null;
    trackingStateRef.current = { isTracking: true, isPaused: false };
    setIsTracking(true);
    setIsPaused(false);
    const didRequestGps = requestUserLocation(true);
    setTrackPaths(didRequestGps ? [] : [[userLocation]]);
    if (!didRequestGps) {
      lastTrackPointRef.current = { location: userLocation, timestamp: Date.now() };
    }
    setTrackTime(0);
    setIsMenuOpen(false);
  };

  const toggleTrackingPause = () => {
    setIsPaused(!isPaused);
    if (isPaused) {
      lastTrackPointRef.current = null;
      trackingStartedAtRef.current = Date.now();
      setTrackPaths(prev => [...prev, []]);
    }
  };

  const stopTrackingRoute = () => {
    lastTrackPointRef.current = null;
    trackingStartedAtRef.current = 0;
    clearTrackDraft(profile.account);
    setIsTracking(false);
    setTrackPaths([]);
    setTrackTime(0);
    setIsPaused(false);
  };

  const saveTrackingRoute = () => {
    if (trackPaths.some(p => p.length > 1)) {
      setSavedTracks(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        paths: trackPaths.filter(p => p.length > 1),
        color: '#EDC727',
        time: trackTime,
        distance: trackDistanceKm
      }]);
    }
    stopTrackingRoute();
  };

  const locationIcon = React.useMemo(
    () => createLocationIcon(mapStyle, systemTheme.icon, deviceHeading),
    [deviceHeading, mapStyle, systemTheme.icon]
  );
  const editingStar = editingNoteTarget
    ? stars.find(star => star.id === editingNoteTarget.starId)
    : null;

  const showRouteDetailDots = mapZoom >= ROUTE_DETAIL_DOT_MIN_ZOOM;

  return (
    <div className="relative w-[100dvw] h-[100dvh] overflow-hidden bg-[#e5e5e5] font-sans" style={appThemeVars}>
      <input
        ref={photoLocationInputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={handlePhotoLocationInput}
      />
      
      <MapCanvas
        mapStyle={mapStyle}
        mapTiles={MAP_TILES}
        position={position}
        userLocation={userLocation}
        locationIcon={locationIcon}
        flyTarget={flyTarget}
        activeTag={activeTag}
        stars={stars}
        selectedStarId={selectedStarId}
        savedTracks={savedTracks}
        selectedTrackId={selectedTrackId}
        selectedTrackLatLng={selectedTrackLatLng}
        language={language}
        tagPolylines={tagPolylines}
        isTracking={isTracking}
        trackPaths={trackPaths}
        showRouteDetailDots={showRouteDetailDots}
        badgeColor={systemTheme.icon}
        onZoomChange={setMapZoom}
        onMapDrop={handleMapDrop}
        onMapClick={onMapClick}
        onMapReady={handleMapReady}
        onPrevTag={handlePrevTag}
        onNextTag={handleNextTag}
        onUpdateStar={onUpdateStar}
        onDeleteStar={onDeleteStar}
        onEditStarNote={starId => setEditingNoteTarget({ starId })}
        onUpdateTrack={onUpdateTrack}
        onDeleteTrack={onDeleteTrack}
        onSelectTrack={(trackId, latLng) => {
          setSelectedTrackId(trackId);
          if (latLng) setSelectedTrackLatLng(latLng);
        }}
        onSelectStar={onStarClick}
        onMoveStar={onMoveStar}
      />

      {starDragPreview && (
        <div
          className="pointer-events-none fixed z-[2400] flex h-11 w-11 items-center justify-center rounded-full text-[#EDC727] drop-shadow-lg"
          style={{ left: starDragPreview.x, top: starDragPreview.y, transform: 'translate(-50%, -50%)' }}
        >
          <Star size={34} strokeWidth={UI_ICON_STROKE} fill="currentColor" />
        </div>
      )}

      {activeView === 'map' && <PhotoLocationToast status={photoLocationStatus} />}

      {activeView === 'map' && !isTracking && (
        <MapControlsOverlay
          homeCopy={homeCopy}
          btnClass={btnClass}
          starPlacementButtonClass={starPlacementButtonClass}
          mapStyle={mapStyle}
          isMenuOpen={isMenuOpen}
          isMapStyleMenuOpen={isMapStyleMenuOpen}
          tagMenuOpen={tagMenuOpen}
          tagMode={tagMode}
          isReadingPhotoLocation={isReadingPhotoLocation}
          iconStrokeWidth={UI_ICON_STROKE}
          mapToolIconStroke={MAP_TOOL_ICON_STROKE}
          onToggleMenu={() => setIsMenuOpen(open => !open)}
          onOpenMapStyleMenu={() => setIsMapStyleMenuOpen(true)}
          onSelectMapStyle={style => {
            setMapStyle(style);
            setIsMapStyleMenuOpen(false);
          }}
          onLocateMe={handleLocateMe}
          onToggleTagMenu={toggleTagMenu}
          onSetTagMode={setTagMode}
          onStartRoute={startTrackingRoute}
          onStarPointerDown={handleStarPlacementPointerDown}
          onStarPointerMove={handleStarPlacementPointerMove}
          onStarPointerUp={finishStarPlacementPointer}
          onStarPointerCancel={cancelStarPlacementPointer}
          onStarKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              addStarAtUserLocation();
            }
          }}
          onPhotoGpsClick={() => photoLocationInputRef.current?.click()}
        />
      )}

      {isTracking && (
        <TrackingControlsOverlay
          btnClass={btnClass}
          isPaused={isPaused}
          trackTime={trackTime}
          activeTrackDistanceDisplay={activeTrackDistanceDisplay}
          iconStrokeWidth={UI_ICON_STROKE}
          onTogglePause={toggleTrackingPause}
          onCancel={stopTrackingRoute}
          onSave={saveTrackingRoute}
          formatTime={formatTime}
        />
      )}

      {activeView === 'map' && !isTracking && (
        <MapSearchButton
          btnClass={btnClass}
          searchLabel={homeCopy.search}
          iconStrokeWidth={UI_ICON_STROKE}
          onClick={() => {
            if (isSearchOpen) {
              closeSearchModal();
            } else {
              openSearchModal('text');
            }
          }}
        />
      )}

      <AnimatePresence>
        {isSignedIn && activeView === 'records' && (
          <RecordsScreen
            homeCopy={homeCopy}
            recordsByDate={recordsByDate}
            recordsFilter={recordsFilter}
            selectedRecordsDateKey={selectedRecordsDateKey}
            isRecordsMenuOpen={isRecordsMenuOpen}
            isRecordsCalendarOpen={isRecordsCalendarOpen}
            recordsCalendarDate={recordsCalendarDate}
            recordsCalendarMode={recordsCalendarMode}
            recordsCalendarDays={recordsCalendarDays}
            recordsCalendarEmptyDays={recordsCalendarEmptyDays}
            recordsCalendarMonths={recordsCalendarMonths}
            recordDateKeys={recordDateKeys}
            calendarActivityDateKeys={calendarActivityDateKeys}
            languageLocale={languageLocale}
            screenTopPaddingClass={screenTopPaddingClass}
            iconStrokeWidth={UI_ICON_STROKE}
            onToggleMenu={() => setIsRecordsMenuOpen(open => !open)}
            onOpenCalendar={openRecordsCalendarPanel}
            onOpenSearch={() => {
              setIsRecordsMenuOpen(false);
              openSearchModal('text');
            }}
            onSetRecordsFilter={filter => {
              setRecordsFilter(filter);
              setSelectedRecordsDateKey(null);
            }}
            onClearDateFilter={() => setSelectedRecordsDateKey(null)}
            onOpenRecord={openReaderFromRecord}
            onCloseCalendar={() => setIsRecordsCalendarOpen(false)}
            onToggleCalendarMode={() => setRecordsCalendarMode(mode => mode === 'month' ? 'year' : 'month')}
            onCalendarNavigate={setRecordsCalendarDate}
            onSelectCalendarDate={dateKey => {
              setSelectedRecordsDateKey(dateKey);
              setRecordsFilter('all');
              setIsRecordsCalendarOpen(false);
            }}
            onSelectCalendarMonth={month => {
              setRecordsCalendarDate(month);
              setRecordsCalendarMode('month');
            }}
          />
        )}
      </AnimatePresence>

      <HomeScreen
        isOpen={activeView === 'home'}
        isSignedIn={isSignedIn}
        homeCopy={homeCopy}
        language={language}
        screenTopPaddingClass={screenTopPaddingClass}
        iconStrokeWidth={UI_ICON_STROKE}
        avatarInputRef={avatarInputRef}
        homeScrollRef={homeScrollRef}
        onAvatarInput={handleAvatarInput}
        authMode={authMode}
        isAuthBusy={isAuthBusy}
        cloudConfigError={cloudConfigError}
        loginAccount={loginAccount}
        loginPassword={loginPassword}
        registerInviteCode={registerInviteCode}
        loginError={loginError}
        onLoginAccountChange={setLoginAccount}
        onLoginPasswordChange={setLoginPassword}
        onRegisterInviteCodeChange={setRegisterInviteCode}
        onLanguageChange={setLanguage}
        onAuthModeChange={setAuthMode}
        onLoginErrorChange={setLoginError}
        onPasswordRevealChange={setIsPasswordRevealed}
        onLoginSubmit={handleLogin}
        onRegisterSubmit={handleRegister}
        profile={profile}
        profileAvatarSrc={profileAvatarSrc}
        activeHomePanel={activeHomePanel}
        onActiveHomePanelChange={setActiveHomePanel}
        onCloseHomePanel={closeHomePanel}
        isCloudBackendEnabled={isCloudBackendEnabled}
        isPasswordRevealed={isPasswordRevealed}
        passwordChangeStatus={passwordChangeStatus}
        onProfileNameChange={name => setProfile(prev => ({ ...prev, name }))}
        onProfilePasswordChange={password => setProfile(prev => ({ ...prev, password }))}
        onOpenPasswordChange={() => {
          setIsPasswordChangeOpen(true);
          setPasswordChangeStatus('');
        }}
        systemTheme={systemTheme}
        activeThemeColorKey={activeThemeColorKey}
        showThemeCustomPicker={showThemeCustomPicker}
        onThemePresetSelect={theme => {
          setSystemTheme(theme);
          setActiveThemeColorKey(null);
          setShowThemeCustomPicker(false);
        }}
        onThemeColorMenuToggle={key => {
          const isOpen = activeThemeColorKey === key;
          setActiveThemeColorKey(isOpen ? null : key);
          setShowThemeCustomPicker(false);
        }}
        onThemeColorChange={updateThemeColor}
        onToggleThemeCustomPicker={() => setShowThemeCustomPicker(prev => !prev)}
        uploadedImages={uploadedImages}
        onPreviewImage={setGalleryPreviewImage}
        permissionRequestState={permissionRequestState}
        permissionStatusText={permissionStatusText}
        mcpPlainToken={mcpPlainToken}
        mcpTokenStatus={mcpTokenStatus}
        mcpTokens={mcpTokens}
        isMcpTokenBusy={isMcpTokenBusy}
        isExportingData={isExportingData}
        exportDataStatus={exportDataStatus}
        onOpenPermissions={handleOpenPermissions}
        onSignOut={handleSignOut}
        onExportUserData={handleExportUserData}
        onCopyMcpText={handleCopyMcpText}
        onCreateMcpToken={handleCreateMcpToken}
        onRevokeMcpToken={handleRevokeMcpToken}
      />

      <InitialPermissionPrompt
        isOpen={isInitialPermissionPromptOpen && isSignedIn}
        copy={homeCopy}
        permissionRequestState={permissionRequestState}
        iconStrokeWidth={UI_ICON_STROKE}
        onClose={closeInitialPermissionPrompt}
        onRequest={handleInitialPermissionRequest}
      />

      <PasswordChangeModal
        isOpen={isPasswordChangeOpen && isSignedIn && isCloudBackendEnabled && activeHomePanel === 'profile'}
        copy={homeCopy}
        iconStrokeWidth={UI_ICON_STROKE}
        currentPassword={currentPasswordInput}
        newPassword={newPasswordInput}
        confirmPassword={confirmPasswordInput}
        status={passwordChangeStatus}
        isChanging={isChangingPassword}
        onCurrentPasswordChange={value => {
          setCurrentPasswordInput(value);
          setPasswordChangeStatus('');
        }}
        onNewPasswordChange={value => {
          setNewPasswordInput(value);
          setPasswordChangeStatus('');
        }}
        onConfirmPasswordChange={value => {
          setConfirmPasswordInput(value);
          setPasswordChangeStatus('');
        }}
        onClose={() => {
          setIsPasswordChangeOpen(false);
          setCurrentPasswordInput('');
          setNewPasswordInput('');
          setConfirmPasswordInput('');
          setPasswordChangeStatus('');
        }}
        onSubmit={() => { void handleChangePassword(); }}
      />

      <ReaderScreen
        isOpen={activeView === 'reader'}
        isSignedIn={isSignedIn}
        readerRecord={readerRecord}
        homeCopy={homeCopy}
        screenTopPaddingClass={screenTopPaddingClass}
        iconStrokeWidth={UI_ICON_STROKE}
        readerCameraInputRef={readerCameraInputRef}
        readerImageInputRef={readerImageInputRef}
        readerTitleRef={readerTitleRef}
        readerContentRef={readerContentRef}
        isReaderToolsOpen={isReaderToolsOpen}
        readerActivePanel={readerActivePanel}
        readerSelectedFontSize={readerSelectedFontSize}
        readerSelectedColor={readerSelectedColor}
        readerSelectedUnderline={readerSelectedUnderline}
        readerShowCustomPicker={readerShowCustomPicker}
        onReaderImageInput={handleReaderImageInput}
        onBackToRecords={() => {
          saveReaderDraft();
          setActiveView('records');
          setReadingNoteTarget(null);
          setIsReaderToolsOpen(false);
          setReaderActivePanel(null);
        }}
        onReaderBeforeInput={handleReaderBeforeInput}
        onReaderInput={handleReaderInput}
        onReaderPaste={handleReaderPaste}
        onSaveReaderSelection={saveReaderSelection}
        onReaderContentClick={handleReaderContentClick}
        onSaveReaderDraft={() => {
          saveReaderDraft();
          setReaderActivePanel(null);
        }}
        onKeepReaderSelectionPointerDown={keepReaderSelectionPointerDown}
        onReaderPanelToggle={handleReaderPanelToggle}
        onReaderFontSize={handleReaderFontSize}
        onReaderUnderline={handleReaderUnderline}
        onReaderTextColor={handleReaderTextColor}
        onToggleCustomPicker={() => setReaderShowCustomPicker(prev => !prev)}
        onCollapseTools={() => {
          setReaderActivePanel(null);
          setIsReaderToolsOpen(false);
        }}
        onExpandTools={() => setIsReaderToolsOpen(true)}
        onLocateReaderRecord={locateReaderRecord}
        formatRecordMonth={formatRecordMonth}
      />

      <AnimatePresence>
        {isSignedIn && activeView === 'stats' && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className="absolute inset-0 z-[900]"
          >
            <TripStatisticsView
              activityPoints={mapActivity.points}
              activityCount={markedLocationCount}
              textRankings={starRecordRankings}
              language={language}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSignedIn && activeView === 'searchResults' && (
          <SearchResultsScreen
            records={searchResultRecords}
            query={submittedTextSearch}
            copy={homeCopy}
            languageLocale={languageLocale}
            screenTopPaddingClass={screenTopPaddingClass}
            iconStrokeWidth={UI_ICON_STROKE}
            onBack={closeSearchResults}
            onOpenRecord={openReaderFromRecord}
            formatRecordMonth={formatRecordMonth}
            formatRecordTime={formatRecordTime}
          />
        )}
      </AnimatePresence>

      <SearchModal
        isOpen={isSearchOpen && activeView !== 'home' && activeView !== 'stats' && activeView !== 'reader' && !isTracking}
        activeSearchField={activeSearchField}
        coordinateSearch={coordinateSearch}
        textSearch={textSearch}
        copy={homeCopy}
        iconStrokeWidth={UI_ICON_STROKE}
        onClose={closeSearchModal}
        onActiveFieldChange={setActiveSearchField}
        onCoordinateChange={setCoordinateSearch}
        onTextChange={value => {
          setTextSearch(value);
          setSubmittedTextSearch('');
        }}
        onCoordinateSubmit={handleCoordinateSearch}
        onTextSubmit={handleTextSearch}
      />

      <BottomNavigation
        isVisible={isSignedIn && activeView !== 'reader' && activeView !== 'searchResults'}
        activeView={activeView}
        copy={homeCopy}
        iconStrokeWidth={UI_ICON_STROKE}
        onMap={() => {
          setActiveView('map');
          setActiveHomePanel(null);
          setIsRecordsMenuOpen(false);
        }}
        onStats={() => {
          setActiveView('stats');
          setActiveHomePanel(null);
          setIsMenuOpen(false);
          setIsMapStyleMenuOpen(false);
          setTagMenuOpen(false);
          setIsRecordsMenuOpen(false);
          setIsRecordsCalendarOpen(false);
        }}
        onRecords={() => {
          setActiveView('records');
          setActiveHomePanel(null);
          setIsMenuOpen(false);
          setIsMapStyleMenuOpen(false);
          setTagMenuOpen(false);
        }}
        onHome={() => {
          setActiveView('home');
          setIsMenuOpen(false);
          setIsMapStyleMenuOpen(false);
          setTagMenuOpen(false);
          setIsRecordsMenuOpen(false);
        }}
      />

      <AnimatePresence>
        {editingNoteTarget && editingStar && (
          <NoteEditorModal
             star={editingStar}
             initialNoteId={editingNoteTarget.noteId}
             language={language}
             mediaRefreshKey={mediaRefreshKey}
             onClose={() => setEditingNoteTarget(null)}
             onSave={(notes) => {
               setStars(prev => prev.map(s => s.id === editingNoteTarget.starId ? { ...s, notes } : s));
             }}
          />
        )}
      </AnimatePresence>

      <GalleryPreviewOverlay
        image={galleryPreviewImage}
        copy={homeCopy}
        iconStrokeWidth={UI_ICON_STROKE}
        onClose={() => setGalleryPreviewImage(null)}
        onDownload={downloadGalleryImage}
      />
    </div>
  );
}
