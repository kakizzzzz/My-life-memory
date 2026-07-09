import React from 'react';
import L from 'leaflet';
import { HOME_COPY } from '../copy/homeCopy';
import {
  clearTrackDraft,
  readTrackDraft,
  writeTrackDraft,
} from '../lib/localPersistence';
import { normalizeAccountId } from '../lib/accountUtils';
import {
  getTrackAccuracy,
  shouldAcceptTrackPoint,
  type TrackPoint,
  type TrackPointMetadata,
} from '../lib/trackUtils';
import { TRACK_STALE_POSITION_GRACE_MS } from '../constants/appDefaults';
import { useTrackSummary } from './useTrackSummary';
import type { AppView, HomePanel, TrackData } from '../types/app';

type TrackingState = {
  isTracking: boolean;
  isPaused: boolean;
};

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
  const checkedTrackDraftAccountRef = React.useRef<string | null>(null);
  const lastTrackPointRef = React.useRef<TrackPoint | null>(null);
  const trackingStartedAtRef = React.useRef(0);
  const trackingStateRef = React.useRef({ isTracking, isPaused });
  const trackDraftStateRef = React.useRef({ paths: trackPaths, time: trackTime });
  const { trackDistanceKm, activeTrackDistanceDisplay, formatTime } = useTrackSummary(trackPaths);

  React.useEffect(() => {
    const nextTrackingState = { isTracking, isPaused };
    trackingStateRef.current = nextTrackingState;
    onTrackingStateChange?.(nextTrackingState);
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

  const startTrackingRoute = React.useCallback(() => {
    clearTrackDraft(profileAccount);
    void startHeadingWatch();
    const startedAt = Date.now();
    trackingStartedAtRef.current = startedAt;
    lastTrackPointRef.current = null;
    const nextTrackingState = { isTracking: true, isPaused: false };
    trackingStateRef.current = nextTrackingState;
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
    setIsPaused(!isPaused);
    if (isPaused) {
      lastTrackPointRef.current = null;
      trackingStartedAtRef.current = Date.now();
      setTrackPaths(prev => [...prev, []]);
    }
    onTrackingStateChange?.({ isTracking, isPaused: !isPaused });
  }, [isPaused, isTracking, onTrackingStateChange]);

  const stopTrackingRoute = React.useCallback(() => {
    lastTrackPointRef.current = null;
    trackingStartedAtRef.current = 0;
    clearTrackDraft(profileAccount);
    const nextTrackingState = { isTracking: false, isPaused: false };
    trackingStateRef.current = nextTrackingState;
    onTrackingStateChange?.(nextTrackingState);
    setIsTracking(false);
    setTrackPaths([]);
    setTrackTime(0);
    setIsPaused(false);
  }, [onTrackingStateChange, profileAccount]);

  const saveTrackingRoute = React.useCallback(() => {
    if (trackPaths.some(path => path.length > 1)) {
      setSavedTracks(prev => [...prev, {
        id: Math.random().toString(36).substr(2, 9),
        paths: trackPaths.filter(path => path.length > 1),
        color: '#EDC727',
        time: trackTime,
        distance: trackDistanceKm,
      }]);
    }
    stopTrackingRoute();
  }, [stopTrackingRoute, trackDistanceKm, trackPaths, trackTime]);

  React.useEffect(() => {
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
      setIsTracking(true);
      setIsPaused(true);
      const nextTrackingState = { isTracking: true, isPaused: true };
      trackingStateRef.current = nextTrackingState;
      onTrackingStateChange?.(nextTrackingState);
      lastTrackPointRef.current = null;
      trackingStartedAtRef.current = Date.now();
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
      writeTrackDraft(account, {
        paths,
        time: trackDraftStateRef.current.time,
        savedAt: Date.now(),
      });
    };

    saveDraft();
    const interval = window.setInterval(saveDraft, 4000);
    return () => window.clearInterval(interval);
  }, [isSignedIn, isTracking, profileAccount]);

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
    trackingStateRef,
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
