import React from 'react';
import L from 'leaflet';
import {
  DEFAULT_RECORD_STAR_ID,
  DEFAULT_RECORD_STAR_LOCATION,
  DEFAULT_USER_LOCATION,
  GEOLOCATION_OPTIONS,
  LEGACY_RECORD_STAR_LOCATION,
} from '../constants/appDefaults';
import {
  createDefaultRecordStar,
  getNearbyDefaultStarLocation,
  isNearCoordinate,
  normalizeInitialStars,
} from '../lib/defaultStarUtils';
import {
  canUseBrowserGeolocation,
  getBrowserGeolocationFailure,
  getCompassHeading,
  getGeolocationFailureReason,
  type DeviceOrientationEventConstructorWithPermission,
  type DeviceOrientationEventWithCompass,
  type LocationRequestResult,
} from '../lib/sensorUtils';
import {
  getBearingBetweenPoints,
  type TrackPointMetadata,
} from '../lib/trackUtils';
import type { AppView, StarData } from '../types/app';

export type PermissionRequestState = 'idle' | 'requesting' | 'ready' | 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout';

type TrackingState = {
  isTracking: boolean;
  isPaused: boolean;
};

const PASSIVE_GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 30_000,
  timeout: 10_000,
};

export const useLocationController = ({
  initialStars,
  isSignedIn,
  activeView,
}: {
  initialStars?: StarData[];
  isSignedIn: boolean;
  activeView: AppView;
}) => {
  const [userLocation, setUserLocation] = React.useState<[number, number]>(DEFAULT_USER_LOCATION);
  const [flyTarget, setFlyTarget] = React.useState<[number, number] | null>(null);
  const [deviceHeading, setDeviceHeading] = React.useState(0);
  const [isWatchingUserLocation, setIsWatchingUserLocation] = React.useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = React.useState(() => (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  ));
  const [stars, setStars] = React.useState<StarData[]>(() => (
    normalizeInitialStars(initialStars) || [createDefaultRecordStar()]
  ));
  const [permissionRequestState, setPermissionRequestState] = React.useState<PermissionRequestState>('idle');
  const [isInitialPermissionPromptOpen, setIsInitialPermissionPromptOpen] = React.useState(false);
  const [hasSeenInitialPermissionPrompt, setHasSeenInitialPermissionPrompt] = React.useState(false);
  const [trackingActive, setTrackingActive] = React.useState(false);

  const isLocating = React.useRef(false);
  const pendingLocationShouldFlyRef = React.useRef(false);
  const locationRequestEpochRef = React.useRef(0);
  const locationRequestWaitersRef = React.useRef<Array<(result: LocationRequestResult) => void>>([]);
  const gpsWatchIdRef = React.useRef<number | null>(null);
  const headingWatchCleanupRef = React.useRef<(() => void) | null>(null);
  const lastGpsLocationRef = React.useRef<[number, number] | null>(null);
  const appendTrackPointRef = React.useRef<((newLoc: [number, number], metadata?: TrackPointMetadata) => void) | null>(null);
  const trackingStateRef = React.useRef<TrackingState>({ isTracking: false, isPaused: false });
  const lastCompassHeadingAtRef = React.useRef(0);
  const isRequestingHeadingPermissionRef = React.useRef(false);
  const hasSyncedDefaultStarToGpsRef = React.useRef(false);
  const hasRequestedEntryLocationRef = React.useRef(false);

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

  const cancelPendingLocationRequest = React.useCallback(() => {
    locationRequestEpochRef.current += 1;
    isLocating.current = false;
    pendingLocationShouldFlyRef.current = false;
    const waiters = locationRequestWaitersRef.current.splice(0);
    waiters.forEach(resolve => resolve({ ready: false, reason: 'unavailable' }));
  }, []);

  const requestCurrentPosition = React.useCallback((options: PositionOptions) => new Promise<LocationRequestResult>(resolve => {
    locationRequestWaitersRef.current.push(resolve);
    if (isLocating.current) return;

    isLocating.current = true;
    const requestEpoch = locationRequestEpochRef.current;
    navigator.geolocation.getCurrentPosition(
      position => {
        if (locationRequestEpochRef.current !== requestEpoch) return;
        const shouldFly = pendingLocationShouldFlyRef.current;
        isLocating.current = false;
        pendingLocationShouldFlyRef.current = false;
        applyGpsPosition(position, shouldFly);
        const waiters = locationRequestWaitersRef.current.splice(0);
        waiters.forEach(waiter => waiter({ ready: true, reason: null }));
      },
      error => {
        if (locationRequestEpochRef.current !== requestEpoch) return;
        isLocating.current = false;
        pendingLocationShouldFlyRef.current = false;
        if (error.code === error.PERMISSION_DENIED && !trackingStateRef.current.isTracking) {
          setIsWatchingUserLocation(false);
        }
        const reason = getGeolocationFailureReason(error);
        const waiters = locationRequestWaitersRef.current.splice(0);
        waiters.forEach(waiter => waiter({ ready: false, reason }));
      },
      options
    );
  }), [applyGpsPosition]);

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

  const requestTrackingLocation = React.useCallback(async (): Promise<LocationRequestResult> => {
    const capabilityFailure = getBrowserGeolocationFailure();
    if (capabilityFailure) return { ready: false, reason: capabilityFailure } as LocationRequestResult;

    // Route recording must wait for a fresh, successful high-accuracy fix. It
    // intentionally does not enable the map's separate passive location watch.
    cancelPendingLocationRequest();
    pendingLocationShouldFlyRef.current = true;
    const result = await requestCurrentPosition(GEOLOCATION_OPTIONS);
    if (!result.ready || lastGpsLocationRef.current !== null) return result;
    return { ready: false, reason: 'unavailable' };
  }, [cancelPendingLocationRequest, requestCurrentPosition]);

  const requestLocationPermissionOnce = React.useCallback(async (): Promise<LocationRequestResult> => {
    const capabilityFailure = getBrowserGeolocationFailure();
    if (capabilityFailure) {
      setIsWatchingUserLocation(false);
      return { ready: false, reason: capabilityFailure } as LocationRequestResult;
    }

    const result = await requestCurrentPosition(PASSIVE_GEOLOCATION_OPTIONS);
    setIsWatchingUserLocation(result.ready);
    return result;
  }, [requestCurrentPosition]);

  const requestAppPermissions = React.useCallback(async (): Promise<PermissionRequestState> => {
    const capabilityFailure = getBrowserGeolocationFailure();
    if (capabilityFailure) {
      setPermissionRequestState(capabilityFailure);
      return capabilityFailure;
    }

    const canRequestHeading = Boolean(window.DeviceOrientationEvent);
    setPermissionRequestState('requesting');
    const headingRequest = canRequestHeading
      ? startHeadingWatch(true).catch(() => undefined)
      : Promise.resolve();
    const [locationResult] = await Promise.all([requestLocationPermissionOnce(), headingRequest]);
    const nextState: PermissionRequestState = locationResult.ready ? 'ready' : locationResult.reason;
    setPermissionRequestState(nextState);
    return nextState;
  }, [requestLocationPermissionOnce, startHeadingWatch]);

  const handleOpenPermissions = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    setHasSeenInitialPermissionPrompt(true);
    setIsInitialPermissionPromptOpen(false);
    await requestAppPermissions();
  }, [requestAppPermissions]);

  const closeInitialPermissionPrompt = React.useCallback(() => {
    setHasSeenInitialPermissionPrompt(true);
    setIsInitialPermissionPromptOpen(false);
  }, []);

  const handleInitialPermissionRequest = React.useCallback(async () => {
    setHasSeenInitialPermissionPrompt(true);
    const nextState = await requestAppPermissions();
    if (nextState !== 'ready') return;
    setIsInitialPermissionPromptOpen(false);
    if (lastGpsLocationRef.current) {
      setFlyTarget(lastGpsLocationRef.current);
    }
  }, [requestAppPermissions]);

  React.useEffect(() => {
    if (!isSignedIn || activeView !== 'map' || hasRequestedEntryLocationRef.current) return;
    hasRequestedEntryLocationRef.current = true;

    if (!hasSeenInitialPermissionPrompt && permissionRequestState !== 'ready') {
      setIsInitialPermissionPromptOpen(true);
      return;
    }

    const capabilityFailure = getBrowserGeolocationFailure();
    if (capabilityFailure) {
      setPermissionRequestState(capabilityFailure);
      return;
    }

    let isCancelled = false;
    setPermissionRequestState('requesting');
    requestLocationPermissionOnce().then(locationResult => {
      if (isCancelled) return;
      setPermissionRequestState(locationResult.ready ? 'ready' : locationResult.reason);
      if (locationResult.ready && lastGpsLocationRef.current) {
        setFlyTarget(lastGpsLocationRef.current);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [activeView, hasSeenInitialPermissionPrompt, isSignedIn, permissionRequestState, requestLocationPermissionOnce]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== 'hidden');
    };
    handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  React.useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    const debugWindow = window as typeof window & {
      __MAP_APP_SENSOR_DEBUG__?: Record<string, unknown>;
    };
    debugWindow.__MAP_APP_SENSOR_DEBUG__ = {
      userLocation,
      deviceHeading,
      isWatchingUserLocation,
      isTracking: trackingActive,
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
    return () => {
      delete debugWindow.__MAP_APP_SENSOR_DEBUG__;
    };
  }, [deviceHeading, isWatchingUserLocation, trackingActive, userLocation]);

  React.useEffect(() => {
    const shouldWatchLocation = trackingActive || (
      isWatchingUserLocation &&
      activeView === 'map' &&
      isDocumentVisible
    );

    if (!shouldWatchLocation || !canUseBrowserGeolocation()) {
      stopGpsWatch();
      return;
    }

    const options = trackingActive ? GEOLOCATION_OPTIONS : PASSIVE_GEOLOCATION_OPTIONS;
    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      position => applyGpsPosition(position),
      error => {
        if (error.code !== error.PERMISSION_DENIED) return;
        stopGpsWatch();
        if (!trackingStateRef.current.isTracking) {
          setIsWatchingUserLocation(false);
        }
      },
      options
    );

    return stopGpsWatch;
  }, [activeView, applyGpsPosition, isDocumentVisible, isWatchingUserLocation, stopGpsWatch, trackingActive]);

  React.useEffect(() => {
    if (trackingActive) return;
    if (activeView !== 'map' || !isDocumentVisible) stopHeadingWatch();
  }, [activeView, isDocumentVisible, stopHeadingWatch, trackingActive]);

  React.useEffect(() => () => {
    cancelPendingLocationRequest();
    stopGpsWatch();
    stopHeadingWatch();
  }, [cancelPendingLocationRequest, stopGpsWatch, stopHeadingWatch]);

  const getLastGpsLocation = React.useCallback(() => lastGpsLocationRef.current, []);

  const resetLocationSession = React.useCallback(() => {
    cancelPendingLocationRequest();
    hasRequestedEntryLocationRef.current = false;
    hasSyncedDefaultStarToGpsRef.current = false;
    setHasSeenInitialPermissionPrompt(false);
    setIsInitialPermissionPromptOpen(false);
    setPermissionRequestState('idle');
    setIsWatchingUserLocation(false);
    stopGpsWatch();
    if (!trackingStateRef.current.isTracking) stopHeadingWatch();
  }, [cancelPendingLocationRequest, stopGpsWatch, stopHeadingWatch]);

  const setTrackingState = React.useCallback((state: TrackingState) => {
    trackingStateRef.current = state;
    const shouldCollectTrackLocation = state.isTracking && !state.isPaused;
    setTrackingActive(shouldCollectTrackLocation);
    if (shouldCollectTrackLocation) {
      void startHeadingWatch(true);
    } else {
      stopHeadingWatch();
    }
  }, [startHeadingWatch, stopHeadingWatch]);

  return {
    userLocation,
    flyTarget,
    setFlyTarget,
    deviceHeading,
    isWatchingUserLocation,
    stars,
    setStars,
    permissionRequestState,
    isInitialPermissionPromptOpen,
    appendTrackPointRef,
    requestTrackingLocation,
    startHeadingWatch,
    stopHeadingWatch,
    handleOpenPermissions,
    closeInitialPermissionPrompt,
    handleInitialPermissionRequest,
    syncDefaultStarNearUser,
    getLastGpsLocation,
    resetLocationSession,
    setTrackingState,
  };
};
