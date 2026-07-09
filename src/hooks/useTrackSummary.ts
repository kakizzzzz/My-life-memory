import React from 'react';
import L from 'leaflet';
import { formatDistanceDisplay } from '../lib/trackUtils';

export function formatTrackElapsedTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function useTrackSummary(trackPaths: [number, number][][]) {
  const trackDistanceKm = React.useMemo(() => {
    let dist = 0;
    trackPaths.forEach(path => {
      for (let i = 1; i < path.length; i++) {
        dist += L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
      }
    });
    return dist / 1000;
  }, [trackPaths]);

  return {
    trackDistanceKm,
    activeTrackDistanceDisplay: formatDistanceDisplay(trackDistanceKm),
    formatTime: formatTrackElapsedTime,
  };
}
