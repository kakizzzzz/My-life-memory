import React from 'react';
import L from 'leaflet';
import { HOME_COPY } from '../copy/homeCopy';
import {
  clearTrackDraft,
  readTrackDraft,
  writeTrackDraft,
} from '../lib/localPersistence';
import { normalizeAccountId } from '../lib/accountUtils';
import { createClientId } from '../lib/generalUtils';
import {
  getTrackAccuracy,
  shouldAcceptTrackPoint,
  type TrackPoint,
  type TrackPointMetadata,
} from '../lib/trackUtils';
import {
  TRACK_MAX_ACCURACY_METERS,
  TRACK_ROUTE_GOOD_ACCURACY_METERS,
  TRACK_STALE_POSITION_GRACE_MS,
} from '../constants/appDefaults';
import { useTrackSummary } from './useTrackSummary';
import type { AppView, HomePanel, TrackData } from '../types/app';

type TrackingState = {
  isTracking: boolean;
  isPaused: boolean;
};

const WEAK_GPS_SEGMENT_RESET_MS = 15_000;

export const useTrackRecording = ({
  initialSavedTracks,
  isSignedIn,
  profileAccount,
  language,
  userLocation,
  requestUserLocation,
  startHeadingWatch,
  setActiveView,
  setActiveHomePanel,
  onStart,
  onTrackingStateChange,
}: {
  initialSavedTracks?: TrackData[];
  isSignedIn: boolean;
  profileAccount: string;
  language: string;
  userLocation: [number, number];
  requestUserLocation: (shouldFly?: boolean) => boolean;
  startHeadingWatch: (requestPermission?: boolean) => Promise<void>;
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  setActiveHomePanel: React.Dispatch<React.SetStateAction<HomePanel>>;
  onStart: () => void;
  onTrackingStateChange?: (state: TrackingState) => void;
}) => {
  const [isTracking, setIsTracking] = React.useState(false);
  const [isPaused, setIsPaused] = React.useState(false);
  const [trackPaths, setTrackPaths] = React.useState<[number, number][][]>([]);
  const [trackTime, setTrackTime] = React.useState(0);
  const [savedTracks, setSavedTracks] = React.useState<TrackData[]>(() => (
    Array.isArray(initialSavedTracks) ? initialSavedTracks : []
  ));
  const [isTrackGpsWeak, setIsTrackGpsWeak] = React.useState(false);
  const checkedTrackDraftAccountRef = React.useRef<string | null>(null);
  const lastTrackPointRef = React.useRef<TrackPoint | null>(null);
  const trackingStartedAtRef = React.useRef(0);
  const routeCreatedAtRef = React.useRef<number | null>(null);
  const trackDraftStateRef = React.useRef({ paths: trackPaths, time: trackTime });
  const accumulatedActiveMsRef = React.useRef(0);
  const activeClockStartedAtRef = React.useRef<number | null>(null);
  const weakGpsStartedAtRef = React.useRef<number | null>(null);
  const shouldStartSegmentAfterWeakGpsRef = React.useRef(false);
  const { trackDistanceKm, activeTrackDistanceDisplay, formatTime } = useTrackSummary(trackPaths);

  const getElapsedTrackSeconds = React.useCallback((now = Date.now()) => {
    const activeElapsed = activeClockStartedAtRef.current === null
      ? 0
      : Math.max(0, now - activeClockStartedAtRef.current);
    return Math.max(0, Math.floor((accumulatedActiveMsRef.current + activeElapsed) / 1000));
  }, []);

  const syncTrackTimeFromClock = React.useCallback(() => {
    const nextTime = getElapsedTrackSeconds();
    setTrackTime(previous => previous === nextTime ? previous : nextTime);
    return nextTime;
  }, [getElapsedTrackSeconds]);

  const pauseActiveClock = React.useCallback((now = Date.now()) => {
    if (activeClockStartedAtRef.current !== null) {
      accumulatedActiveMsRef.current += Math.max(0, now - activeClockStartedAtRef.current);
      activeClockStartedAtRef.current = null;
    }
    return syncTrackTimeFromClock();
  }, [syncTrackTimeFromClock]);

  const resumeActiveClock = React.useCallback((now = Date.now()) => {
    if (activeClockStartedAtRef.current === null) {
      activeClockStartedAtRef.current = now;
    }
    syncTrackTimeFromClock();
  }, [syncTrackTimeFromClock]);

  React.useEffect(() => {
    onTrackingStateChange?.({ isTracking, isPaused });
  }, [isTracking, isPaused, onTrackingStateChange]);

  React.useEffect(() => {
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
    const hasWeakAccuracy = accuracy !== undefined && accuracy > TRACK_ROUTE_GOOD_ACCURACY_METERS;

    if (hasWeakAccuracy) {
      setIsTrackGpsWeak(true);
      if (weakGpsStartedAtRef.current === null) weakGpsStartedAtRef.current = timestamp;
    } else {
      setIsTrackGpsWeak(false);
      if (
        weakGpsStartedAtRef.current !== null &&
        timestamp - weakGpsStartedAtRef.current >= WEAK_GPS_SEGMENT_RESET_MS
      ) {
        shouldStartSegmentAfterWeakGpsRef.current = true;
      }
      weakGpsStartedAtRef.current = null;
    }

    if (accuracy !== undefined && accuracy > TRACK_MAX_ACCURACY_METERS) {
      return;
    }

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

    if (shouldStartSegmentAfterWeakGpsRef.current && previousAcceptedPoint) {
      shouldStartSegmentAfterWeakGpsRef.current = false;
      startNewSegment();
      return;
    }

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

  const startTrackingRoute = React.useCallback(() => {
    clearTrackDraft(profileAccount);
    void startHeadingWatch();
    const startedAt = Date.now();
    trackingStartedAtRef.current = startedAt;
    routeCreatedAtRef.current = startedAt;
    accumulatedActiveMsRef.current = 0;
    activeClockStartedAtRef.current = startedAt;
    weakGpsStartedAtRef.current = null;
    shouldStartSegmentAfterWeakGpsRef.current = false;
    lastTrackPointRef.current = null;
    setIsTrackGpsWeak(false);
    const nextTrackingState = { isTracking: true, isPaused: false };
    onTrackingStateChange?.(nextTrackingState);
    setIsTracking(true);
    setIsPaused(false);
    const didRequestGps = requestUserLocation(true);
    setTrackPaths(didRequestGps ? [] : [[userLocation]]);
    if (!didRequestGps) {
      lastTrackPointRef.current = { location: userLocation, timestamp: Date.now() };
    }
    setTrackTime(0);
    onStart();
  }, [onStart, onTrackingStateChange, profileAccount, requestUserLocation, startHeadingWatch, userLocation]);

  const toggleTrackingPause = React.useCallback(() => {
    const nextPaused = !isPaused;
    setIsTrackGpsWeak(false);
    weakGpsStartedAtRef.current = null;
    shouldStartSegmentAfterWeakGpsRef.current = false;
    setIsPaused(nextPaused);

    if (nextPaused) {
      pauseActiveClock();
    } else {
      lastTrackPointRef.current = null;
      trackingStartedAtRef.current = Date.now();
      setTrackPaths(prev => [...prev, []]);
      resumeActiveClock();
    }

    onTrackingStateChange?.({ isTracking, isPaused: nextPaused });
  }, [isPaused, isTracking, onTrackingStateChange, pauseActiveClock, resumeActiveClock]);

  const stopTrackingRoute = React.useCallback(() => {
    pauseActiveClock();
    lastTrackPointRef.current = null;
    trackingStartedAtRef.current = 0;
    routeCreatedAtRef.current = null;
    accumulatedActiveMsRef.current = 0;
    activeClockStartedAtRef.current = null;
    weakGpsStartedAtRef.current = null;
    shouldStartSegmentAfterWeakGpsRef.current = false;
    setIsTrackGpsWeak(false);
    clearTrackDraft(profileAccount);
    const nextTrackingState = { isTracking: false, isPaused: false };
    onTrackingStateChange?.(nextTrackingState);
    setIsTracking(false);
    setTrackPaths([]);
    setTrackTime(0);
    setIsPaused(false);
  }, [onTrackingStateChange, pauseActiveClock, profileAccount]);

  const saveTrackingRoute = React.useCallback(() => {
    const finalTrackTime = getElapsedTrackSeconds();
    if (trackPaths.some(path => path.length > 1)) {
      const savedAt = Date.now();
      const createdAt = routeCreatedAtRef.current || savedAt;
      setSavedTracks(prev => [...prev, {
        id: createClientId(),
        paths: trackPaths.filter(path => path.length > 1),
        color: '#EDC727',
        time: finalTrackTime,
        distance: trackDistanceKm,
        createdAt,
        updatedAt: savedAt,
      }]);
    }
    stopTrackingRoute();
  }, [getElapsedTrackSeconds, stopTrackingRoute, trackDistanceKm, trackPaths]);

  React.useEffect(() => {
    if (!isTracking || isPaused) return;
    syncTrackTimeFromClock();
    const interval = window.setInterval(syncTrackTimeFromClock, 1000);
    const handleVisibilityChange = () => {
      if (!document.hidden) syncTrackTimeFromClock();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isPaused, isTracking, syncTrackTimeFromClock]);

  React.useEffect(() => {
    if (!isSignedIn || isTracking) return;
    const account = normalizeAccountId(profileAccount);
    if (!account || checkedTrackDraftAccountRef.current === account) return;
    checkedTrackDraftAccountRef.current = account;

    const draft = readTrackDraft(account);
    if (!draft) return;

    const restorePrompt = (HOME_COPY[language as keyof typeof HOME_COPY] || HOME_COPY.en).restoreTrackDraft;
    if (window.confirm(restorePrompt)) {
      setTrackPaths(draft.paths);
      setTrackTime(draft.time);
      accumulatedActiveMsRef.current = draft.time * 1000;
      activeClockStartedAtRef.current = null;
      setIsTracking(true);
      setIsPaused(true);
      const nextTrackingState = { isTracking: true, isPaused: true };
      onTrackingStateChange?.(nextTrackingState);
      lastTrackPointRef.current = null;
      trackingStartedAtRef.current = Date.now();
      routeCreatedAtRef.current = draft.createdAt || Math.max(0, draft.savedAt - draft.time * 1000);
      setActiveView('map');
      setActiveHomePanel(null);
    } else {
      clearTrackDraft(account);
    }
  }, [isSignedIn, isTracking, language, onTrackingStateChange, profileAccount, setActiveHomePanel, setActiveView]);

  React.useEffect(() => {
    if (!isSignedIn || !isTracking) return;
    const account = normalizeAccountId(profileAccount);
    if (!account) return;

    const saveDraft = () => {
      const paths = trackDraftStateRef.current.paths.filter(path => path.length > 0);
      if (paths.length === 0) return;
      const time = isPaused ? trackDraftStateRef.current.time : getElapsedTrackSeconds();
      writeTrackDraft(account, {
        paths,
        time,
        createdAt: routeCreatedAtRef.current || Math.max(0, Date.now() - time * 1000),
        savedAt: Date.now(),
      });
    };

    saveDraft();
    const interval = window.setInterval(saveDraft, 4000);
    return () => window.clearInterval(interval);
  }, [getElapsedTrackSeconds, isPaused, isSignedIn, isTracking, profileAccount]);

  const resetTrackDraftCheck = React.useCallback(() => {
    checkedTrackDraftAccountRef.current = null;
  }, []);

  return {
    isTracking,
    isPaused,
    trackPaths,
    trackTime,
    savedTracks,
    setSavedTracks,
    isTrackGpsWeak,
    appendTrackPoint,
    activeTrackDistanceDisplay,
    formatTime,
    startTrackingRoute,
    toggleTrackingPause,
    stopTrackingRoute,
    saveTrackingRoute,
    resetTrackDraftCheck,
  };
};
