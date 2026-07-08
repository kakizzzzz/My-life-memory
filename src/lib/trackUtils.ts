import L from 'leaflet';
import {
  TRACK_MAX_ACCURACY_METERS,
  TRACK_MAX_DYNAMIC_MIN_DISTANCE_METERS,
  TRACK_MAX_PLAUSIBLE_SPEED_MPS,
  TRACK_MAX_SEGMENT_GAP_MS,
  TRACK_MIN_DISTANCE_METERS,
  TRACK_MIN_POINT_INTERVAL_MS,
} from '../constants/appDefaults';

export type TrackPoint = {
  location: [number, number];
  timestamp: number;
  accuracy?: number;
};

export type TrackPointMetadata = {
  accuracy?: number;
  timestamp?: number;
  speed?: number | null;
};

export type TrackPointDecision = {
  action: 'accept' | 'reject' | 'segment';
  distanceMeters: number;
  elapsedMs: number;
};

const ROUTE_DOT_INTERVAL_METERS = 100;

export const ROUTE_DETAIL_DOT_MIN_ZOOM = 15;

const clampTrackValue = (value: number, min: number, max: number) => (
  Math.min(max, Math.max(min, value))
);

export const getTrackAccuracy = (accuracy: unknown) => (
  typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0
    ? accuracy
    : undefined
);

const getDynamicTrackMinDistance = ({
  previousAccuracy,
  nextAccuracy,
  computedSpeed,
  reportedSpeed,
}: {
  previousAccuracy?: number;
  nextAccuracy?: number;
  computedSpeed: number;
  reportedSpeed: number | null;
}) => {
  const accuracyReference = Math.max(previousAccuracy ?? 0, nextAccuracy ?? 0);
  const speedReference = Math.max(computedSpeed, reportedSpeed ?? 0);
  const accuracyNoiseFloor = accuracyReference * 0.1;
  const speedNoiseFloor = speedReference * 0.8;
  return clampTrackValue(
    Math.max(TRACK_MIN_DISTANCE_METERS, accuracyNoiseFloor, speedNoiseFloor),
    TRACK_MIN_DISTANCE_METERS,
    TRACK_MAX_DYNAMIC_MIN_DISTANCE_METERS
  );
};

const getDynamicTrackMaxSegmentDistance = (
  elapsedSeconds: number,
  previousAccuracy?: number,
  nextAccuracy?: number
) => {
  const accuracyPadding = Math.max(previousAccuracy ?? 0, nextAccuracy ?? 0) * 2;
  return Math.max(80, elapsedSeconds * TRACK_MAX_PLAUSIBLE_SPEED_MPS + accuracyPadding);
};

// Adaptive movement recording: this keeps one route algorithm for walking,
// cycling, driving, and normal transit without exposing a transport-mode UI.
export const shouldAcceptTrackPoint = (
  previousPoint: TrackPoint | null,
  nextPoint: TrackPoint,
  metadata: TrackPointMetadata = {}
): TrackPointDecision => {
  const nextAccuracy = getTrackAccuracy(metadata.accuracy ?? nextPoint.accuracy);
  if (nextAccuracy !== undefined && nextAccuracy > TRACK_MAX_ACCURACY_METERS) {
    return { action: 'reject', distanceMeters: 0, elapsedMs: 0 };
  }

  if (!previousPoint) {
    return { action: 'segment', distanceMeters: 0, elapsedMs: 0 };
  }

  const distanceMeters = L.latLng(previousPoint.location).distanceTo(L.latLng(nextPoint.location));
  const elapsedMs = Math.max(0, nextPoint.timestamp - previousPoint.timestamp);
  const elapsedSeconds = elapsedMs / 1000;
  const computedSpeed = elapsedSeconds > 0 ? distanceMeters / elapsedSeconds : 0;
  const reportedSpeed = (
    typeof metadata.speed === 'number' && Number.isFinite(metadata.speed) && metadata.speed >= 0
  ) ? metadata.speed : null;

  if (elapsedMs < TRACK_MIN_POINT_INTERVAL_MS) {
    return { action: 'reject', distanceMeters, elapsedMs };
  }

  const dynamicMinDistance = getDynamicTrackMinDistance({
    previousAccuracy: previousPoint.accuracy,
    nextAccuracy,
    computedSpeed,
    reportedSpeed,
  });
  if (distanceMeters < dynamicMinDistance) {
    return { action: 'reject', distanceMeters, elapsedMs };
  }

  if (computedSpeed > TRACK_MAX_PLAUSIBLE_SPEED_MPS) {
    return { action: 'reject', distanceMeters, elapsedMs };
  }

  if (elapsedMs > TRACK_MAX_SEGMENT_GAP_MS) {
    return { action: 'segment', distanceMeters, elapsedMs };
  }

  const dynamicMaxDistance = getDynamicTrackMaxSegmentDistance(
    elapsedSeconds,
    previousPoint.accuracy,
    nextAccuracy
  );
  if (distanceMeters > dynamicMaxDistance) {
    return { action: 'segment', distanceMeters, elapsedMs };
  }

  return { action: 'accept', distanceMeters, elapsedMs };
};

export const getBearingBetweenPoints = (from: [number, number], to: [number, number]) => {
  const fromLat = from[0] * Math.PI / 180;
  const toLat = to[0] * Math.PI / 180;
  const deltaLng = (to[1] - from[1]) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

export const formatDistanceDisplay = (distanceKm = 0) => {
  const safeDistanceKm = Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  if (safeDistanceKm < 1) {
    return {
      value: String(Math.round(safeDistanceKm * 1000)),
      unit: 'm',
    };
  }
  return {
    value: safeDistanceKm.toFixed(1),
    unit: 'km',
  };
};

export function getPointsEveryXMeters(path: [number, number][], intervalMeters: number) {
  const points: [number, number][] = [];
  if (path.length === 0) return points;

  points.push(path[0]);

  let currentDistance = 0;
  let nextDistance = intervalMeters;
  for (let i = 1; i < path.length; i++) {
    const p1 = L.latLng(path[i - 1]);
    const p2 = L.latLng(path[i]);
    const dist = p1.distanceTo(p2);

    while (currentDistance + dist >= nextDistance) {
      const fraction = (nextDistance - currentDistance) / dist;
      const lat = p1.lat + (p2.lat - p1.lat) * fraction;
      const lng = p1.lng + (p2.lng - p1.lng) * fraction;
      points.push([lat, lng] as [number, number]);
      nextDistance += intervalMeters;
    }
    currentDistance += dist;
  }

  if (path.length > 1 && points.length > 0 &&
      (points[points.length - 1][0] !== path[path.length - 1][0] ||
       points[points.length - 1][1] !== path[path.length - 1][1])) {
    points.push(path[path.length - 1]);
  }

  return points;
}

export function getVisibleRouteDots(path: [number, number][], showDetailDots: boolean) {
  const dots = getPointsEveryXMeters(path, ROUTE_DOT_INTERVAL_METERS);
  if (showDetailDots || dots.length <= 2) return dots;

  const first = dots[0];
  const last = dots[dots.length - 1];
  if (!first || !last) return [];
  if (first[0] === last[0] && first[1] === last[1]) return [first];

  return [first, last];
}
