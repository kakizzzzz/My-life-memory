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
import { TripStatisticsView, type MapActivityPoint, type TextRankingItem } from './TripStatisticsView';
import { isCloudBackendEnabled, supabaseConfigMessage } from './lib/supabaseClient';
import {
  buildStorageImageSrc,
  dehydrateStorageMediaHtml,
  deleteImageFromStorageReliably,
  hydrateStorageMediaHtml,
  imageMetadataFromElement,
  isSupabaseMediaEnabled,
  retryPendingImageDeletions,
  storagePlaceholderSrc,
  uploadImageToStorage,
  warmStorageImageUrls,
  type StoredImageMetadata,
} from './lib/mediaStorage';
import { sanitizeRichHtml } from './lib/htmlSanitizer';
import { normalizePersistedAppState } from './lib/appStateNormalize';
import { exportReadableUserData } from './lib/userDataExport';
import {
  dateFromCalendarDateKey,
  formatRecordMonth,
  formatRecordTime,
  getCalendarDateKey,
} from './lib/dateUtils';
import {
  formatDistanceDisplay,
  getBearingBetweenPoints,
  getPointsEveryXMeters,
  getTrackAccuracy,
  ROUTE_DETAIL_DOT_MIN_ZOOM,
  shouldAcceptTrackPoint,
  type TrackPoint,
  type TrackPointMetadata,
} from './lib/trackUtils';
import {
  compressImageFileToDataUrl,
  dataUrlToFile,
  getImageDownloadFileName,
  readPhotoGpsCoordinates,
} from './lib/photoUtils';
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
  cleanReaderHtml,
  ensureReaderEditableTailAfterMedia,
  escapeHtml,
  extractImagesFromHtml,
  extractStoredImagesFromHtml,
  getReadableNoteHtml,
  getReadableTitleHtml,
  getRemovedStoredImages,
  getStoredImagesFromNote,
  hasMeaningfulNoteContent,
  htmlToText,
  imageToReaderHtml,
  readerEditableTailHtml,
  uniqueStoredImages,
} from './lib/noteHtmlUtils';
import { createClientId } from './lib/generalUtils';
import { countSearchMatches, parseCoordinateSearch } from './lib/searchUtils';
import { getNoteTimestamp } from './lib/noteDataUtils';
import {
  applyReaderStyleToSelection as applyReaderDomStyleToSelection,
  getReaderElementForTarget as getReaderDomElementForTarget,
  getReaderSelectionRange as getReaderDomSelectionRange,
  insertStyledReaderText as insertStyledReaderDomText,
  moveReaderCaretToContentEnd as moveReaderDomCaretToContentEnd,
  moveReaderCaretToPoint as moveReaderDomCaretToPoint,
  readerRangeIsInsideElement,
  readerRangeStartsInsideNonEditable,
  saveReaderSelectionRange,
  type ReaderTextTarget,
} from './lib/readerDomUtils';
import type {
  AppView,
  HomePanel,
  MapStyle,
  NoteData,
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
  updateCloudPassword,
  type CloudAuthAction,
  CloudAuthError,
  createCloudMcpToken,
  listCloudMcpTokens,
  revokeCloudMcpToken,
  type CloudAppState,
  type CloudProfile,
  type CloudMcpTokenInfo,
} from './lib/cloudBackend';

type EditingNoteTarget = {
  starId: string;
  noteId?: string;
};

type ReadingNoteTarget = {
  starId: string;
  noteId: string;
};

type NavigatorWithFileShare = Navigator & {
  canShare?: (data: { files?: File[]; title?: string }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
};

const deleteStoredImages = (metadataList: StoredImageMetadata[]) => {
  uniqueStoredImages(metadataList).forEach(metadata => {
    void deleteImageFromStorageReliably(metadata);
  });
};

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
  const [mcpTokens, setMcpTokens] = useState<CloudMcpTokenInfo[]>([]);
  const [mcpPlainToken, setMcpPlainToken] = useState('');
  const [mcpTokenStatus, setMcpTokenStatus] = useState('');
  const [isMcpTokenBusy, setIsMcpTokenBusy] = useState(false);
  const [isPasswordChangeOpen, setIsPasswordChangeOpen] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChangeStatus, setPasswordChangeStatus] = useState('');
  const [isReadingPhotoLocation, setIsReadingPhotoLocation] = useState(false);
  const [photoLocationStatus, setPhotoLocationStatus] = useState('');
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
  const [readingNoteTarget, setReadingNoteTarget] = useState<ReadingNoteTarget | null>(null);
  const [isReaderToolsOpen, setIsReaderToolsOpen] = useState(false);
  const [readerActivePanel, setReaderActivePanel] = useState<'font' | 'color' | null>(null);
  const [readerActiveTextTarget, setReaderActiveTextTarget] = useState<ReaderTextTarget>('content');
  const [readerSelectedFontSize, setReaderSelectedFontSize] = useState(18);
  const [readerSelectedColor, setReaderSelectedColor] = useState('#D2936D');
  const [readerSelectedUnderline, setReaderSelectedUnderline] = useState(false);
  const [readerShowCustomPicker, setReaderShowCustomPicker] = useState(false);
  const readerTitleRef = React.useRef<HTMLHeadingElement>(null);
  const readerContentRef = React.useRef<HTMLDivElement>(null);
  const readerCameraInputRef = React.useRef<HTMLInputElement>(null);
  const readerImageInputRef = React.useRef<HTMLInputElement>(null);
  const readerSavedRangeRef = React.useRef<Range | null>(null);
  const readerPendingTitleStylesRef = React.useRef<Record<string, string>>({});
  const readerPendingContentStylesRef = React.useRef<Record<string, string>>({});

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
  const [starDragPreview, setStarDragPreview] = useState<{ x: number; y: number } | null>(null);

  const isLocating = React.useRef(false);
  const mapInstanceRef = React.useRef<L.Map | null>(null);
  const starPlacementDragRef = React.useRef<{ pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);
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
  const photoLocationStatusTimerRef = React.useRef<number | null>(null);
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
    if (photoLocationStatusTimerRef.current !== null) {
      window.clearTimeout(photoLocationStatusTimerRef.current);
    }
  }, [stopGpsWatch, stopHeadingWatch]);

  // Remove the useEffect that depends on userLocation, we will update trackPaths directly in drag handlers
  const trackDistanceKm = React.useMemo(() => {
    let dist = 0;
    trackPaths.forEach(path => {
      for (let i = 1; i < path.length; i++) {
        dist += L.latLng(path[i-1]).distanceTo(L.latLng(path[i]));
      }
    });
    return dist / 1000;
  }, [trackPaths]);
  const activeTrackDistanceDisplay = formatDistanceDisplay(trackDistanceKm);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const onMapClick = React.useCallback(() => {
    setSelectedStarId(null);
    setActiveTag(null);
    setSelectedTrackId(null);
    setSelectedTrackLatLng(null);
  }, []);

  const handleLocateMe = React.useCallback(() => {
    setFlyTarget([userLocation[0], userLocation[1]]);
  }, [userLocation]);

  const handleMapReady = React.useCallback((map: L.Map | null) => {
    mapInstanceRef.current = map;
    if (map) setMapZoom(map.getZoom());
  }, []);

  const addStarAtLatLng = React.useCallback((lat: number, lng: number, starData: Partial<StarData> = {}) => {
    const id = starData.id || createClientId();
    const createdAt = starData.createdAt || Date.now();
    setStars(prev => [...prev, { ...starData, id, lat, lng, createdAt }]);
    return id;
  }, []);

  const addStarAtUserLocation = React.useCallback(() => {
    addStarAtLatLng(userLocation[0], userLocation[1]);
  }, [addStarAtLatLng, userLocation]);

  const placeStarAtClientPoint = React.useCallback((clientX: number, clientY: number) => {
    const map = mapInstanceRef.current;
    if (!map) {
      addStarAtUserLocation();
      return;
    }

    const rect = map.getContainer().getBoundingClientRect();
    const isInsideMap =
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom;

    if (!isInsideMap) return;

    const latlng = map.containerPointToLatLng(L.point(clientX - rect.left, clientY - rect.top));
    addStarAtLatLng(latlng.lat, latlng.lng);
  }, [addStarAtLatLng, addStarAtUserLocation]);

  const handleStarPlacementPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    starPlacementDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
  };

  const handleStarPlacementPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (distance > 6) {
      dragState.dragging = true;
      setStarDragPreview({ x: event.clientX, y: event.clientY });
      event.preventDefault();
    }
  };

  const finishStarPlacementPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }

    if (dragState.dragging) {
      placeStarAtClientPoint(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    } else {
      addStarAtUserLocation();
    }

    starPlacementDragRef.current = null;
    setStarDragPreview(null);
  };

  const cancelStarPlacementPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    const dragState = starPlacementDragRef.current;
    if (dragState?.pointerId === event.pointerId) {
      starPlacementDragRef.current = null;
      setStarDragPreview(null);
    }
  };

  const handleMapDrop = (e: DragEvent, map: L.Map) => {
    const type = e.dataTransfer?.getData('text/plain');
    if (type === 'star') {
      const latlng = map.mouseEventToLatLng(e as unknown as MouseEvent);
      addStarAtLatLng(latlng.lat, latlng.lng);
    }
  };

  const onStarClick = (id: string, e: any) => {
    const clickedStar = stars.find(s => s.id === id);
    if (clickedStar) {
      setFlyTarget([clickedStar.lat, clickedStar.lng]);
    }

    if (tagMode === 'add') {
      setStars(prev => {
        const star = prev.find(s => s.id === id);
        if (star?.tagOrder) return prev; // already tagged
        const groupStars = prev.filter(s => s.tagGroupId === currentTagGroupId);
        const maxTag = groupStars.reduce((max, s) => Math.max(max, s.tagOrder || 0), 0);
        return prev.map(s => s.id === id ? { ...s, tagOrder: maxTag + 1, tagGroupId: currentTagGroupId } : s);
      });
      setSelectedStarId(id);
    } else if (tagMode === 'remove') {
      setStars(prev => {
        const star = prev.find(s => s.id === id);
        if (!star?.tagOrder) return prev;
        const removedTag = star.tagOrder;
        const groupId = star.tagGroupId;
        return prev.map(s => {
          if (s.id === id) return { ...s, tagOrder: undefined, tagGroupId: undefined };
          if (s.tagGroupId === groupId && s.tagOrder && s.tagOrder > removedTag) return { ...s, tagOrder: s.tagOrder - 1 };
          return s;
        });
      });
    } else {
      const star = clickedStar;
      if (star) {
        setSelectedStarId(id);
        if (star.tagOrder && star.tagGroupId !== undefined) {
          setActiveTag({ order: star.tagOrder, groupId: star.tagGroupId });
        } else {
          setActiveTag(null);
        }
      }
    }
  };

  const onUpdateStar = (id: string, updates: Partial<StarData>) => {
    setStars(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const onMoveStar = React.useCallback((id: string, lat: number, lng: number) => {
    setStars(prev => prev.map(star => star.id === id ? { ...star, lat, lng } : star));
  }, []);

  const onDeleteStar = (id: string) => {
    const deletedStar = stars.find(star => star.id === id);
    if (deletedStar) {
      deleteStoredImages((deletedStar.notes || []).flatMap(note => getStoredImagesFromNote(note)));
    }

    setStars(prev => {
      const star = prev.find(s => s.id === id);
      if (star && star.tagOrder) {
        const groupId = star.tagGroupId;
        // reorder remaining tags
        return prev.filter(s => s.id !== id).map(s => {
          if (s.tagGroupId === groupId && s.tagOrder && s.tagOrder > star.tagOrder!) return { ...s, tagOrder: s.tagOrder - 1 };
          return s;
        });
      }
      return prev.filter(s => s.id !== id);
    });
    if (selectedStarId === id) setSelectedStarId(null);
  };

  const toggleTagMenu = () => {
    if (tagMenuOpen) {
      setTagMenuOpen(false);
      setTagMode('none');
    } else {
      setTagMenuOpen(true);
      setTagMode('add');
      setCurrentTagGroupId(Date.now());
    }
  };

  const handlePrevTag = () => {
    if (!activeTag) return;
    const groupStars = stars.filter(s => s.tagGroupId === activeTag.groupId);
    const maxTag = groupStars.reduce((max, s) => Math.max(max, s.tagOrder || 0), 0);
    const nextOrder = activeTag.order > 1 ? activeTag.order - 1 : maxTag;
    setActiveTag({ order: nextOrder, groupId: activeTag.groupId });
    const s = groupStars.find(s => s.tagOrder === nextOrder);
    if (s) {
      setFlyTarget([s.lat, s.lng]);
      setSelectedStarId(s.id);
    }
  };

  const handleNextTag = () => {
    if (!activeTag) return;
    const groupStars = stars.filter(s => s.tagGroupId === activeTag.groupId);
    const maxTag = groupStars.reduce((max, s) => Math.max(max, s.tagOrder || 0), 0);
    const nextOrder = activeTag.order < maxTag ? activeTag.order + 1 : 1;
    setActiveTag({ order: nextOrder, groupId: activeTag.groupId });
    const s = groupStars.find(s => s.tagOrder === nextOrder);
    if (s) {
      setFlyTarget([s.lat, s.lng]);
      setSelectedStarId(s.id);
    }
  };

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

  const mapTiles = {
    light: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    },
    dark: {
      url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    },
    aerial: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: 'Tiles &copy; Esri'
    }
  };


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

  const uploadedImages = React.useMemo<UploadedImage[]>(() => {
    const images: UploadedImage[] = [];
    stars.forEach((star, starIndex) => {
      (star.notes || []).forEach((note, noteIndex) => {
        const hydratedContentHtml = hydrateStorageMediaHtml(sanitizeRichHtml(note.contentHtml || ''));
        const metadataSources = (note.images || [])
          .map(metadata => buildStorageImageSrc(metadata))
          .filter((src): src is string => Boolean(src));
        const sources = [
          ...extractImagesFromHtml(hydratedContentHtml),
          ...metadataSources,
          ...(Array.isArray(note.imageUrls) ? note.imageUrls : []),
          ...(note.imageUrl ? [note.imageUrl] : []),
        ];
        Array.from(new Set(sources)).forEach((src, imageIndex) => {
          images.push({
            id: `${star.id}-${note.id}-${imageIndex}`,
            src,
            title: note.title || `${homeCopy.noteLabel} ${noteIndex + 1} / ${homeCopy.starLabel} ${starIndex + 1}`,
          });
        });
      });
    });
    return images;
  }, [homeCopy.noteLabel, homeCopy.starLabel, mediaRefreshKey, stars]);

  const noteRecords = React.useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentYear = now.getFullYear();

    return stars
      .flatMap((star, starIndex) => (
        (star.notes || []).map((note, noteIndex) => {
          const timestamp = getNoteTimestamp(note);
          const date = new Date(timestamp);
          const text = htmlToText(note.contentHtml) || note.content || note.title || homeCopy.untitledNote;
          const title = htmlToText(note.titleHtml) || note.title || `${homeCopy.noteLabel} ${noteIndex + 1}`;
          return {
            id: `${star.id}-${note.id}`,
            starId: star.id,
            noteId: note.id,
            starIndex,
            noteIndex,
            lat: star.lat,
            lng: star.lng,
            color: star.color || '#EDC727',
            title,
            text,
            timestamp,
            day: date.getDate(),
            year: date.getFullYear(),
            monthKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
            dateKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
            hasContent: hasMeaningfulNoteContent(note),
          };
        })
      ))
      .filter(record => {
        if (!record.hasContent) return false;
        if (selectedRecordsDateKey && record.dateKey !== selectedRecordsDateKey) return false;
        if (recordsFilter === 'monthly' && record.monthKey !== currentMonthKey) return false;
        if (recordsFilter === 'annual' && record.year !== currentYear) return false;
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [homeCopy.noteLabel, homeCopy.untitledNote, recordsFilter, selectedRecordsDateKey, stars]);

  const searchResultRecords = React.useMemo(() => {
    const query = submittedTextSearch.trim().toLowerCase();
    if (!query) return [];

    return stars
      .flatMap((star, starIndex) => (
        (star.notes || []).map((note, noteIndex) => {
          const timestamp = getNoteTimestamp(note);
          const title = htmlToText(note.titleHtml) || note.title || `${homeCopy.noteLabel} ${noteIndex + 1}`;
          const text = htmlToText(note.contentHtml) || note.content || title || homeCopy.untitledNote;
          const searchableText = text === title ? title : `${title} ${text}`;
          const matchCount = countSearchMatches(searchableText, query);
          return {
            id: `${star.id}-${note.id}`,
            starId: star.id,
            noteId: note.id,
            starIndex,
            noteIndex,
            title,
            text,
            timestamp,
            color: star.color || '#EDC727',
            matchCount,
            hasContent: hasMeaningfulNoteContent(note),
            isMatch: matchCount > 0,
          };
        })
      ))
      .filter(record => record.hasContent && record.isMatch)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [homeCopy.noteLabel, homeCopy.untitledNote, stars, submittedTextSearch]);

  const recordsByDate = React.useMemo(() => {
    const groups = new Map<string, typeof noteRecords>();
    noteRecords.forEach(record => {
      if (!groups.has(record.dateKey)) groups.set(record.dateKey, []);
      groups.get(record.dateKey)!.push(record);
    });
    return Array.from(groups.entries())
      .map(([dateKey, records]) => ({
        dateKey,
        records: [...records].sort((a, b) => b.timestamp - a.timestamp),
      }))
      .sort((a, b) => (b.records[0]?.timestamp || 0) - (a.records[0]?.timestamp || 0));
  }, [noteRecords]);

  const recordDateSummaries = React.useMemo(() => {
    const counts = new Map<string, { dateKey: string; day: number; month: string; timestamp: number; count: number }>();
    stars.forEach(star => {
      (star.notes || []).forEach(note => {
        if (!hasMeaningfulNoteContent(note)) return;
        const timestamp = getNoteTimestamp(note);
        const date = new Date(timestamp);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const existing = counts.get(dateKey);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(dateKey, {
            dateKey,
            day: date.getDate(),
            month: formatRecordMonth(timestamp),
            timestamp,
            count: 1,
          });
        }
      });
    });
    return Array.from(counts.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [stars]);

  const recordDateKeys = React.useMemo(() => (
    new Set(recordDateSummaries.map(date => date.dateKey))
  ), [recordDateSummaries]);

  const calendarActivityDateKeys = React.useMemo(() => {
    const keys = new Set(recordDateSummaries.map(date => date.dateKey));
    stars.forEach(star => {
      if (!star.createdAt) return;
      keys.add(getCalendarDateKey(new Date(star.createdAt)));
    });
    return keys;
  }, [recordDateSummaries, stars]);

  const mapActivity = React.useMemo(() => {
    const points: MapActivityPoint[] = [];

    const addPoint = (lat: number, lng: number, weight: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || weight <= 0) return;
      points.push({ lat, lng, weight });
    };

    stars.forEach(star => {
      addPoint(star.lat, star.lng, 1);
      const meaningfulNoteCount = (star.notes || []).filter(hasMeaningfulNoteContent).length;
      if (meaningfulNoteCount > 0) addPoint(star.lat, star.lng, meaningfulNoteCount);
    });

    const taggedGroups = new Map<number, StarData[]>();
    stars
      .filter(star => star.tagOrder !== undefined && star.tagGroupId !== undefined)
      .forEach(star => {
        if (!taggedGroups.has(star.tagGroupId!)) taggedGroups.set(star.tagGroupId!, []);
        taggedGroups.get(star.tagGroupId!)!.push(star);
      });

    taggedGroups.forEach(groupStars => {
      const orderedStars = [...groupStars].sort((a, b) => (a.tagOrder || 0) - (b.tagOrder || 0));
      for (let index = 1; index < orderedStars.length; index += 1) {
        const prev = orderedStars[index - 1];
        const next = orderedStars[index];
        addPoint((prev.lat + next.lat) / 2, (prev.lng + next.lng) / 2, 0.75);
      }
    });

    const addTrackPath = (path: [number, number][], weight: number) => {
      if (path.length < 2) return;
      const sampledPoints = getPointsEveryXMeters(path, 500);
      sampledPoints.forEach(([lat, lng]) => addPoint(lat, lng, weight));
    };

    savedTracks.forEach(track => {
      track.paths.forEach(path => addTrackPath(path, 0.35));
    });

    if (isTracking) {
      trackPaths.forEach(path => addTrackPath(path, 0.25));
    }

    return { points };
  }, [stars, savedTracks, isTracking, trackPaths]);

  const markedLocationCount = React.useMemo(() => stars.length, [stars]);

  const starRecordRankings = React.useMemo<TextRankingItem[]>(() => (
    stars
      .map((star, index) => ({
        name: String(index + 1),
        value: (star.notes || []).filter(hasMeaningfulNoteContent).length,
        fill: star.color || '#EDC727',
      }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((item, index) => ({ ...item, name: String(index + 1) }))
  ), [stars]);

  const recordsCalendarDays = React.useMemo(() => {
    const year = recordsCalendarDate.getFullYear();
    const month = recordsCalendarDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1));
  }, [recordsCalendarDate]);

  const recordsCalendarEmptyDays = React.useMemo(() => (
    Array.from({ length: new Date(recordsCalendarDate.getFullYear(), recordsCalendarDate.getMonth(), 1).getDay() })
  ), [recordsCalendarDate]);

  const recordsCalendarMonths = React.useMemo(() => (
    Array.from({ length: 12 }, (_, month) => new Date(recordsCalendarDate.getFullYear(), month, 1))
  ), [recordsCalendarDate]);

  const handleCoordinateSearch = () => {
    const coordinates = parseCoordinateSearch(coordinateSearch);
    if (!coordinates) return;
    setFlyTarget(coordinates);
    setActiveView('map');
    setActiveHomePanel(null);
    setIsSearchOpen(false);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
  };

  const handleTextSearch = () => {
    const query = textSearch.trim();
    if (!query) {
      setSubmittedTextSearch('');
      closeSearchModal();
      return;
    }

    if (activeView === 'records') {
      setSelectedRecordsDateKey(null);
    }

    setActiveSearchField('text');
    setSearchReturnView(activeView === 'map' ? 'map' : 'records');
    setSubmittedTextSearch(query);
    setIsSearchOpen(false);
    setActiveHomePanel(null);
    setIsMenuOpen(false);
    setIsMapStyleMenuOpen(false);
    setTagMenuOpen(false);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
    setActiveView('searchResults');
  };

  const openSearchModal = (field: SearchField = 'text') => {
    setActiveSearchField(field);
    setSubmittedTextSearch('');
    setIsSearchOpen(true);
  };

  const closeSearchModal = () => {
    setIsSearchOpen(false);
    setSubmittedTextSearch('');
  };

  const closeSearchResults = () => {
    setSubmittedTextSearch('');
    setActiveView(searchReturnView);
  };

  const handleAvatarInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const imageUrl = await compressImageFileToDataUrl(file);
    const previousAvatarImage = profile.avatarImage;
    let avatarUrl = imageUrl;
    let avatarImage: StoredImageMetadata | undefined;

    if (isSupabaseMediaEnabled) {
      try {
        const compressedFile = await dataUrlToFile(imageUrl, `avatar-${Date.now()}.jpg`);
        const uploaded = await uploadImageToStorage(compressedFile, {
          folder: 'avatars',
          noteId: 'profile',
          fileName: compressedFile.name,
        });
        if (uploaded.metadata) {
          avatarUrl = storagePlaceholderSrc(uploaded.metadata);
          avatarImage = uploaded.metadata;
        }
      } catch (error) {
        console.warn('Supabase Storage avatar upload failed, using data URL fallback:', error);
      }
    }

    setProfile(prev => ({ ...prev, avatarUrl, avatarImage }));
    if (previousAvatarImage && previousAvatarImage.key !== avatarImage?.key) {
      void deleteImageFromStorageReliably(previousAvatarImage);
    }
    event.target.value = '';
  };

  const updateThemeColor = (key: keyof SystemTheme, value: string) => {
    setSystemTheme(prev => ({ ...prev, [key]: value }));
  };

  const downloadGalleryImageFallback = (href: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const downloadGalleryImage = async (image: UploadedImage) => {
    let objectUrl: string | null = null;
    const fallbackFileName = getImageDownloadFileName(image.title);

    try {
      const response = await fetch(image.src);
      if (!response.ok) throw new Error('Could not fetch image.');

      const blob = await response.blob();
      const mimeType = blob.type || 'image/jpeg';
      const fileName = getImageDownloadFileName(image.title, mimeType);
      const file = new File([blob], fileName, { type: mimeType });
      const shareNavigator = navigator as NavigatorWithFileShare;

      if (shareNavigator.share && (!shareNavigator.canShare || shareNavigator.canShare({ files: [file], title: image.title }))) {
        await shareNavigator.share({ files: [file], title: image.title });
        return;
      }

      objectUrl = URL.createObjectURL(blob);
      downloadGalleryImageFallback(objectUrl, fileName);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Could not open native image save flow, falling back to download:', error);
        downloadGalleryImageFallback(image.src, fallbackFileName);
      }
    } finally {
      if (objectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  };

  const showPhotoLocationStatus = React.useCallback((message: string, durationMs = 500) => {
    if (photoLocationStatusTimerRef.current !== null) {
      window.clearTimeout(photoLocationStatusTimerRef.current);
      photoLocationStatusTimerRef.current = null;
    }
    setPhotoLocationStatus(message);
    if (durationMs > 0) {
      photoLocationStatusTimerRef.current = window.setTimeout(() => {
        setPhotoLocationStatus('');
        photoLocationStatusTimerRef.current = null;
      }, durationMs);
    }
  }, []);

  const handlePhotoLocationInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const looksLikeImage = file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
    if (!looksLikeImage) return;
    if (isReadingPhotoLocation) return;

    setIsReadingPhotoLocation(true);
    showPhotoLocationStatus(homeCopy.photoLocationLoading, 0);

    try {
      const coordinates = await readPhotoGpsCoordinates(file);
      if (!coordinates) {
        showPhotoLocationStatus(homeCopy.photoLocationNoGps, 500);
        return;
      }

      const [lat, lng] = coordinates;
      const timestamp = Date.now();
      const starId = createClientId();
      const noteId = createClientId();
      const imageUrl = await compressImageFileToDataUrl(file);
      let imageHtml = imageToReaderHtml(imageUrl, homeCopy.noteImageAlt, homeCopy.removeImage);
      let imageMetadata: StoredImageMetadata | undefined;

      if (isSupabaseMediaEnabled) {
        try {
          const compressedFile = await dataUrlToFile(imageUrl, file.name || `${timestamp}.jpg`);
          const uploaded = await uploadImageToStorage(compressedFile, {
            noteId,
            folder: 'notes',
            fileName: compressedFile.name,
          });
          if (uploaded.metadata) {
            imageMetadata = uploaded.metadata;
            imageHtml = imageToReaderHtml(uploaded.src, homeCopy.noteImageAlt, homeCopy.removeImage, uploaded.metadata);
          }
        } catch (error) {
          console.warn('Supabase Storage photo GPS upload failed, using data URL fallback:', error);
        }
      }

      const contentHtml = sanitizeRichHtml(dehydrateStorageMediaHtml(`${imageHtml}${readerEditableTailHtml}`));
      const title = homeCopy.photoGpsNoteTitle;
      const note: NoteData = {
        id: noteId,
        title,
        titleHtml: sanitizeRichHtml(escapeHtml(title)),
        content: '',
        contentHtml,
        images: imageMetadata ? [imageMetadata] : undefined,
        fontSize: 18,
        titleFontSize: 18,
        createdAt: timestamp,
        updatedAt: timestamp,
        color: '#D2936D',
      };

      addStarAtLatLng(lat, lng, {
        id: starId,
        createdAt: timestamp,
        color: '#EDC727',
        notes: [note],
      });
      setSelectedStarId(starId);
      setActiveTag(null);
      setFlyTarget([lat, lng]);
      setIsMenuOpen(false);
      showPhotoLocationStatus(homeCopy.photoLocationCreated, 500);
    } catch (error) {
      console.error('Could not create star from photo GPS:', error);
      showPhotoLocationStatus(homeCopy.photoLocationFailed, 500);
    } finally {
      setIsReadingPhotoLocation(false);
    }
  };

  const handleChangePassword = async () => {
    if (isChangingPassword) return;

    const currentPassword = currentPasswordInput;
    const newPassword = newPasswordInput;
    const confirmPassword = confirmPasswordInput;

    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      setPasswordChangeStatus(homeCopy.loginMissing);
      return;
    }
    if (newPassword.length < CLOUD_PASSWORD_MIN_LENGTH) {
      setPasswordChangeStatus(homeCopy.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordChangeStatus(homeCopy.passwordMismatch);
      return;
    }

    setIsChangingPassword(true);
    setPasswordChangeStatus('');

    try {
      await updateCloudPassword({
        account: profile.account,
        currentPassword,
        newPassword,
      });
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      setIsPasswordChangeOpen(false);
      setPasswordChangeStatus(homeCopy.passwordChanged);
    } catch (error) {
      console.error('Could not change password:', error);
      if (error instanceof CloudAuthError && error.code === 'invalid_credentials') {
        setPasswordChangeStatus(homeCopy.currentPasswordWrong);
      } else if (error instanceof CloudAuthError && error.code === 'weak_password') {
        setPasswordChangeStatus(homeCopy.passwordTooShort);
      } else {
        setPasswordChangeStatus(getCloudAuthErrorMessage(error, 'login'));
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  };

  const loadMcpTokens = async () => {
    if (!isCloudBackendEnabled || !isSignedIn) return;
    try {
      const tokens = await listCloudMcpTokens();
      setMcpTokens(tokens);
    } catch (error) {
      console.error('Could not load MCP tokens:', error);
      setMcpTokenStatus(homeCopy.mcpFailed);
    }
  };

  const handleCreateMcpToken = async () => {
    if (isMcpTokenBusy) return;
    setIsMcpTokenBusy(true);
    setMcpTokenStatus('');
    setMcpPlainToken('');
    try {
      const result = await createCloudMcpToken(`${profile.account || 'My'} MCP`);
      setMcpPlainToken(result.token);
      setMcpTokens([result.tokenInfo]);
      setMcpTokenStatus(homeCopy.mcpTokenReady);
    } catch (error) {
      console.error('Could not create MCP token:', error);
      setMcpTokenStatus(homeCopy.mcpFailed);
    } finally {
      setIsMcpTokenBusy(false);
    }
  };

  const handleCopyMcpText = async (text: string) => {
    try {
      await copyToClipboard(text);
      setMcpTokenStatus(homeCopy.mcpCopied);
      window.setTimeout(() => setMcpTokenStatus(''), 800);
    } catch (error) {
      console.error('Could not copy MCP text:', error);
      setMcpTokenStatus(homeCopy.mcpFailed);
    }
  };

  const handleRevokeMcpToken = async (tokenId: string) => {
    if (isMcpTokenBusy) return;
    setIsMcpTokenBusy(true);
    setMcpTokenStatus('');
    try {
      await revokeCloudMcpToken(tokenId);
      setMcpTokens(current => current.filter(token => token.id !== tokenId));
      setMcpTokenStatus(homeCopy.mcpRevoked);
    } catch (error) {
      console.error('Could not revoke MCP token:', error);
      setMcpTokenStatus(homeCopy.mcpFailed);
    } finally {
      setIsMcpTokenBusy(false);
    }
  };

  useEffect(() => {
    if (isSignedIn && activeHomePanel === 'mcp' && isCloudBackendEnabled) {
      void loadMcpTokens();
      return;
    }
    setMcpPlainToken('');
    setMcpTokenStatus('');
  }, [activeHomePanel, isSignedIn]);

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
  const readerRecord = React.useMemo(() => {
    if (!readingNoteTarget) return null;
    const star = stars.find(item => item.id === readingNoteTarget.starId);
    const note = star?.notes?.find(item => item.id === readingNoteTarget.noteId);
    if (!star || !note) return null;
    return {
      star,
      note,
      timestamp: getNoteTimestamp(note),
      titleHtml: getReadableTitleHtml(note, homeCopy.untitledNote),
      contentHtml: getReadableNoteHtml(note, homeCopy.noteImageAlt, homeCopy.removeImage),
    };
  }, [homeCopy.noteImageAlt, homeCopy.removeImage, homeCopy.untitledNote, mediaRefreshKey, readingNoteTarget, stars]);
  const readerRecordKey = readerRecord ? `${readerRecord.star.id}-${readerRecord.note.id}` : null;

  React.useLayoutEffect(() => {
    if (activeView !== 'reader' || !readerRecord) return;
    const titleEditor = readerTitleRef.current;
    const contentEditor = readerContentRef.current;

    if (titleEditor && titleEditor.innerHTML !== readerRecord.titleHtml) {
      titleEditor.innerHTML = sanitizeRichHtml(readerRecord.titleHtml);
    }

    if (contentEditor && contentEditor.innerHTML !== readerRecord.contentHtml) {
      contentEditor.innerHTML = sanitizeRichHtml(readerRecord.contentHtml);
    }

    if (contentEditor) ensureReaderEditableTailAfterMedia(contentEditor);
    readerSavedRangeRef.current = null;
    readerPendingTitleStylesRef.current = {};
    readerPendingContentStylesRef.current = {};
    setReaderSelectedUnderline(false);
  }, [activeView, readerRecordKey, readerRecord?.titleHtml, readerRecord?.contentHtml]);

  const saveReaderDraft = React.useCallback((updates: Partial<NoteData> = {}) => {
    if (!readerRecord) return;
    if (readerContentRef.current) ensureReaderEditableTailAfterMedia(readerContentRef.current);
    const titleHtml = sanitizeRichHtml(readerTitleRef.current?.innerHTML ?? readerRecord.titleHtml);
    const rawContentHtml = readerContentRef.current?.innerHTML ?? readerRecord.contentHtml;
    const contentHtml = sanitizeRichHtml(dehydrateStorageMediaHtml(rawContentHtml));
    const title = htmlToText(titleHtml);
    const content = htmlToText(contentHtml);
    const timestamp = Date.now();
    const images = extractStoredImagesFromHtml(contentHtml);
    deleteStoredImages(getRemovedStoredImages(getStoredImagesFromNote(readerRecord.note), images));

    setStars(prev => prev.map(star => {
      if (star.id !== readerRecord.star.id) return star;
      return {
        ...star,
        notes: (star.notes || []).map(note => (
          note.id === readerRecord.note.id
            ? {
                ...note,
                title,
                titleHtml,
                content,
                contentHtml,
                images,
                imageUrl: undefined,
                imageUrls: undefined,
                updatedAt: timestamp,
                ...updates,
              }
            : note
        )),
      };
    }));
  }, [readerRecord]);

  const moveReaderCaretToContentEnd = React.useCallback(() => {
    return moveReaderDomCaretToContentEnd(readerContentRef.current, readerSavedRangeRef);
  }, []);

  const moveReaderCaretToPoint = React.useCallback((clientX: number, clientY: number) => {
    return moveReaderDomCaretToPoint(readerContentRef.current, clientX, clientY, readerSavedRangeRef);
  }, []);

  const getReaderElementForTarget = React.useCallback((target: ReaderTextTarget) => (
    getReaderDomElementForTarget(target, readerTitleRef.current, readerContentRef.current)
  ), []);

  const saveReaderSelection = React.useCallback(() => {
    const toolbarState = saveReaderSelectionRange(
      readerSavedRangeRef,
      readerTitleRef.current,
      readerContentRef.current,
      readerRecord?.note.color || '#D2936D'
    );
    if (!toolbarState) return;
    setReaderActiveTextTarget(toolbarState.target);
    setReaderSelectedFontSize(toolbarState.fontSize);
    setReaderSelectedColor(toolbarState.color);
    setReaderSelectedUnderline(toolbarState.underline);
  }, [readerRecord?.note.color]);

  const getReaderSelectionRange = React.useCallback((target = readerActiveTextTarget) => {
    return getReaderDomSelectionRange(target, readerTitleRef.current, readerContentRef.current, readerSavedRangeRef);
  }, [readerActiveTextTarget]);

  const applyReaderStyleToSelection = React.useCallback((styles: Record<string, string>) => {
    return applyReaderDomStyleToSelection({
      target: readerActiveTextTarget,
      titleEditor: readerTitleRef.current,
      contentEditor: readerContentRef.current,
      savedRangeRef: readerSavedRangeRef,
      pendingTitleStylesRef: readerPendingTitleStylesRef,
      pendingContentStylesRef: readerPendingContentStylesRef,
      styles,
    });
  }, [readerActiveTextTarget]);

  const openReaderFromRecord = React.useCallback((starId: string, noteId: string) => {
    setReadingNoteTarget({ starId, noteId });
    setActiveView('reader');
    setActiveHomePanel(null);
    setIsRecordsMenuOpen(false);
    setIsRecordsCalendarOpen(false);
    setIsSearchOpen(false);
    setSubmittedTextSearch('');
    setIsReaderToolsOpen(false);
    setReaderActivePanel(null);
    setReaderShowCustomPicker(false);
  }, []);

  const locateReaderRecord = React.useCallback(() => {
    if (!readerRecord) return;
    setFlyTarget([readerRecord.star.lat, readerRecord.star.lng]);
    setSelectedStarId(readerRecord.star.id);
    setActiveTag(null);
    setActiveView('map');
    setActiveHomePanel(null);
    setIsReaderToolsOpen(false);
  }, [readerRecord]);

  const keepReaderSelectionPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    saveReaderSelection();
  }, [saveReaderSelection]);

  const handleReaderFontSize = React.useCallback((size: number) => {
    setReaderSelectedFontSize(size);
    applyReaderStyleToSelection({ 'font-size': `${size}px` });
    setReaderActivePanel(null);
  }, [applyReaderStyleToSelection]);

  const handleReaderTextColor = React.useCallback((color: string) => {
    setReaderSelectedColor(color);
    applyReaderStyleToSelection({ color });
  }, [applyReaderStyleToSelection]);

  const handleReaderUnderline = React.useCallback(() => {
    const nextUnderline = !readerSelectedUnderline;
    setReaderSelectedUnderline(nextUnderline);
    setReaderActivePanel(null);
    applyReaderStyleToSelection({ 'text-decoration-line': nextUnderline ? 'underline' : 'none' });
  }, [applyReaderStyleToSelection, readerSelectedUnderline]);

  const insertStyledReaderText = React.useCallback((
    element: HTMLElement | null,
    range: Range | null,
    text: string,
    styles: Record<string, string>
  ) => {
    return insertStyledReaderDomText(element, range, text, styles, readerSavedRangeRef);
  }, []);

  const handleReaderBeforeInput = React.useCallback((target: ReaderTextTarget, event: React.FormEvent<HTMLElement>) => {
    const inputEvent = event.nativeEvent as InputEvent;
    if (inputEvent.inputType !== 'insertText' || !inputEvent.data) return;
    const pendingRef = target === 'title' ? readerPendingTitleStylesRef : readerPendingContentStylesRef;
    const pendingStyles = pendingRef.current;
    if (Object.keys(pendingStyles).length === 0) return;
    const element = getReaderElementForTarget(target);
    if (element && insertStyledReaderText(element, getReaderSelectionRange(target), inputEvent.data, pendingStyles)) {
      event.preventDefault();
    }
  }, [getReaderElementForTarget, getReaderSelectionRange, insertStyledReaderText]);

  const handleReaderInput = React.useCallback(() => {
    const editor = readerContentRef.current;
    if (editor) ensureReaderEditableTailAfterMedia(editor);
    requestAnimationFrame(saveReaderSelection);
  }, [saveReaderSelection]);

  const handleReaderContentClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const editor = readerContentRef.current;
    if (editor) ensureReaderEditableTailAfterMedia(editor);

    const removeButton = target.closest('[data-remove-image="true"]');
    if (removeButton) {
      event.preventDefault();
      const figure = removeButton.closest('[data-note-image="true"]');
      const metadata = imageMetadataFromElement(figure);
      if (metadata) void deleteImageFromStorageReliably(metadata);
      figure?.remove();
      if (editor) ensureReaderEditableTailAfterMedia(editor);
      return;
    }

    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (
      target === editor ||
      target.closest('[data-note-image="true"]') ||
      !range ||
      !editor ||
      !readerRangeIsInsideElement(range, editor) ||
      readerRangeStartsInsideNonEditable(range, editor) ||
      range.startContainer === editor
    ) {
      if (!moveReaderCaretToPoint(event.clientX, event.clientY)) {
        moveReaderCaretToContentEnd();
      }
      return;
    }

    saveReaderSelection();
  }, [moveReaderCaretToContentEnd, moveReaderCaretToPoint, readerRangeIsInsideElement, readerRangeStartsInsideNonEditable, saveReaderSelection]);

  const insertReaderImage = React.useCallback(async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const imageUrl = await compressImageFileToDataUrl(file);
    const editor = readerContentRef.current;
    if (!editor) return;
    let imageHtml = imageToReaderHtml(imageUrl, homeCopy.noteImageAlt, homeCopy.removeImage);

    if (isSupabaseMediaEnabled) {
      try {
        const compressedFile = await dataUrlToFile(imageUrl, `${Date.now()}.jpg`);
        const uploaded = await uploadImageToStorage(compressedFile, {
          noteId: readerRecord?.note.id,
          folder: 'notes',
          fileName: compressedFile.name,
        });
        imageHtml = imageToReaderHtml(uploaded.src, homeCopy.noteImageAlt, homeCopy.removeImage, uploaded.metadata);
      } catch (error) {
        console.warn('Supabase Storage upload failed, using data URL fallback:', error);
      }
    }

    editor.insertAdjacentHTML('beforeend', `${imageHtml}${readerEditableTailHtml}`);
    ensureReaderEditableTailAfterMedia(editor);
    moveReaderCaretToContentEnd();
  }, [homeCopy.noteImageAlt, homeCopy.removeImage, moveReaderCaretToContentEnd, readerRecord?.note.id]);

  const handleReaderPaste = React.useCallback(async (
    target: 'title' | 'content',
    event: React.ClipboardEvent<HTMLElement>
  ) => {
    event.preventDefault();

    if (target === 'content') {
      const imageFiles = Array.from(event.clipboardData.files).filter((file): file is File => (
        file instanceof File && file.type.startsWith('image/')
      ));
      if (imageFiles.length > 0) {
        for (const file of imageFiles) {
          await insertReaderImage(file);
        }
        return;
      }
    }

    const rawText = event.clipboardData.getData('text/plain');
    const text = target === 'title' ? rawText.replace(/\s+/g, ' ').trim() : rawText;
    if (!text) return;

    const element = getReaderElementForTarget(target);
    if (!element) return;
    insertStyledReaderText(element, getReaderSelectionRange(target), text, {});
    handleReaderInput();
  }, [getReaderElementForTarget, getReaderSelectionRange, handleReaderInput, insertReaderImage, insertStyledReaderText]);

  const handleReaderImageInput = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    await insertReaderImage(file);
    event.target.value = '';
  }, [insertReaderImage]);

  const handleReaderPanelToggle = React.useCallback((panel: 'font' | 'color') => {
    saveReaderSelection();
    setReaderShowCustomPicker(false);
    setReaderActivePanel(currentPanel => currentPanel === panel ? null : panel);
  }, [saveReaderSelection]);

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
        mapTiles={mapTiles}
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
