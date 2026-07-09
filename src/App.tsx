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
import { useReaderController } from './hooks/useReaderController';
import { useMapStarActions } from './hooks/useMapStarActions';
import { useSearchActions } from './hooks/useSearchActions';
import { useTrackRecording } from './hooks/useTrackRecording';
import { useCloudMediaMaintenance } from './hooks/useCloudMediaMaintenance';
import { useCloudAuthSync } from './hooks/useCloudAuthSync';
import { isCloudBackendEnabled, supabaseConfigMessage } from './lib/supabaseClient';
import {
  buildStorageImageSrc,
  storagePlaceholderSrc,
} from './lib/mediaStorage';
import { exportReadableUserData } from './lib/userDataExport';
import {
  dateFromCalendarDateKey,
  formatRecordMonth,
  formatRecordTime,
} from './lib/dateUtils';
import {
  getBearingBetweenPoints,
  ROUTE_DETAIL_DOT_MIN_ZOOM,
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
  getPublicProfileSnapshot,
  hasLoginAccount,
  isLanguage,
  isMapStyle,
  markAutoUserManualSeen,
  readAutoUserManualSeen,
  readPersistedAppState,
  writePersistedAppState,
} from './lib/localPersistence';
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

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedTrackLatLng, setSelectedTrackLatLng] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState(16);

  const isLocating = React.useRef(false);
  const gpsWatchIdRef = React.useRef<number | null>(null);
  const headingWatchCleanupRef = React.useRef<(() => void) | null>(null);
  const lastGpsLocationRef = React.useRef<[number, number] | null>(null);
  const appendTrackPointRef = React.useRef<((newLoc: [number, number], metadata?: TrackPointMetadata) => void) | null>(null);
  const lastCompassHeadingAtRef = React.useRef(0);
  const isRequestingHeadingPermissionRef = React.useRef(false);
  const hasSyncedDefaultStarToGpsRef = React.useRef(false);
  const hasRequestedEntryLocationRef = React.useRef(false);
  const autoOpenedManualAccountRef = React.useRef<string | null>(null);

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
      appendTrackPointRef.current?.(newLoc, {
        accuracy,
        timestamp: position.timestamp,
        speed: position.coords.speed,
      });
    }
  }, [applyLocationPoint, syncDefaultStarNearUser]);

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

  const {
    isTracking,
    isPaused,
    trackPaths,
    trackTime,
    savedTracks,
    setSavedTracks,
    trackingStateRef,
    appendTrackPoint,
    activeTrackDistanceDisplay,
    formatTime,
    startTrackingRoute,
    toggleTrackingPause,
    stopTrackingRoute,
    saveTrackingRoute,
    resetTrackDraftCheck,
  } = useTrackRecording({
    initialSavedTracks: persistedPrivateState?.savedTracks,
    isSignedIn,
    profileAccount: profile.account,
    language,
    userLocation,
    requestUserLocation,
    startHeadingWatch,
    setActiveView,
    setActiveHomePanel,
    onStart: () => setIsMenuOpen(false),
  });
  appendTrackPointRef.current = appendTrackPoint;

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
    hasSyncedDefaultStarToGpsRef.current = false;
    resetTrackDraftCheck();
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
  }, [isSignedIn, resetTrackDraftCheck]);

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
  const getLastGpsLocation = React.useCallback(() => lastGpsLocationRef.current, []);
  const {
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
    handleLogin,
    handleRegister,
    handleSignOut,
    getCloudAuthErrorMessage,
  } = useCloudAuthSync({
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
  });
  const handleCloudMediaReady = React.useCallback(() => {
    setMediaRefreshKey(key => key + 1);
  }, []);

  useCloudMediaMaintenance({
    isSignedIn,
    profile,
    stars,
    onMediaReady: handleCloudMediaReady,
  });
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
