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
  getCompassHeading,
  type DeviceOrientationEventConstructorWithPermission,
  type DeviceOrientationEventWithCompass,
} from '../lib/sensorUtils';
import {
  getBearingBetweenPoints,
  type TrackPointMetadata,
} from '../lib/trackUtils';
import type { AppView, StarData } from '../types/app';

export type PermissionRequestState = 'idle' | 'requesting' | 'ready' | 'denied' | 'unsupported';

type TrackingState = {
  isTracking: boolean;
  isPaused: boolean;
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
  const [stars, setStars] = React.useState<StarData[]>(() => (
    normalizeInitialStars(initialStars) || [createDefaultRecordStar()]
  ));
  const [permissionRequestState, setPermissionRequestState] = React.useState<PermissionRequestState>('idle');
  const [isInitialPermissionPromptOpen, setIsInitialPermissionPromptOpen] = React.useState(false);
  const [hasSeenInitialPermissionPrompt, setHasSeenInitialPermissionPrompt] = React.useState(false);
  const [trackingActive, setTrackingActive] = React.useState(false);

  const isLocating = React.useRef(false);
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
  }, [applyLocationPoint, syncDefaultStarNearUser, trackingStateRef]);

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
  }, [applyGpsPosition, trackingStateRef, userLocation]);

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
  }), [applyGpsPosition, trackingStateRef]);

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

  React.useEffect(() => {
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

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as typeof window & {
      __MAP_APP_SENSOR_DEBUG__?: Record<string, unknown>;
    }).__MAP_APP_SENSOR_DEBUG__ = {
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
  }, [deviceHeading, isWatchingUserLocation, trackingActive, userLocation]);

  React.useEffect(() => {
    const shouldWatchLocation = isWatchingUserLocation || trackingActive;

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
  }, [applyGpsPosition, isWatchingUserLocation, stopGpsWatch, trackingActive, trackingStateRef]);

  React.useEffect(() => () => {
    stopGpsWatch();
    stopHeadingWatch();
  }, [stopGpsWatch, stopHeadingWatch]);

  const getLastGpsLocation = React.useCallback(() => lastGpsLocationRef.current, []);

  const resetLocationSession = React.useCallback(() => {
    hasRequestedEntryLocationRef.current = false;
    hasSyncedDefaultStarToGpsRef.current = false;
    setHasSeenInitialPermissionPrompt(false);
    setIsInitialPermissionPromptOpen(false);
  }, []);

  const setTrackingState = React.useCallback((state: TrackingState) => {
    trackingStateRef.current = state;
    setTrackingActive(state.isTracking);
  }, [trackingStateRef]);

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
    requestUserLocation,
    startHeadingWatch,
    handleOpenPermissions,
    closeInitialPermissionPrompt,
    handleInitialPermissionRequest,
    syncDefaultStarNearUser,
    getLastGpsLocation,
    resetLocationSession,
    setTrackingState,
  };
};
