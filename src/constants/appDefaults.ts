import type { UserProfile } from '../types/app';

export const DEFAULT_PROFILE: UserProfile = {
  name: '',
  account: '',
  password: '',
  avatarUrl: '',
};

export const DEFAULT_RECORD_STAR_ID = 'default-record-star';
export const DEFAULT_USER_LOCATION: [number, number] = [31.2304, 121.4737];
export const DEFAULT_RECORD_STAR_LOCATION: [number, number] = [31.2312, 121.4744];
export const LEGACY_RECORD_STAR_LOCATION: [number, number] = [36.36705, 127.34425];

export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 15000,
};

export const TRACK_MAX_ACCURACY_METERS = 150;
export const TRACK_ROUTE_GOOD_ACCURACY_METERS = 50;
export const TRACK_MIN_DISTANCE_METERS = 2;
export const TRACK_MAX_DYNAMIC_MIN_DISTANCE_METERS = 20;
export const TRACK_MAX_PLAUSIBLE_SPEED_MPS = 90;
export const TRACK_MAX_SEGMENT_GAP_MS = 60_000;
export const TRACK_MIN_POINT_INTERVAL_MS = 500;
export const TRACK_STALE_POSITION_GRACE_MS = 2000;
export const CLOUD_PASSWORD_MIN_LENGTH = 8;
export const PRIVACY_NOTICE_VERSION = '2026-07-13';

export const UPLOAD_IMAGE_MAX_BYTES = 100 * 1024;
export const SAMPLE_NOTE_IMAGE_URL = `${import.meta.env.BASE_URL}note-sample.jpg`;
export const SAMPLE_NOTE_TEXT = 'Today was simple and quiet. I walked for a while, took one photo, and saved this small note.';
