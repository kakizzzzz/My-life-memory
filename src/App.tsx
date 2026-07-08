import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import { Menu, Search, Map as MapIcon, PieChart, BookOpen, Home, ChevronDown, ChevronRight, ChevronLeft, ChevronUp, ChevronsLeft, MapPin, Route, Star, X, Save, Copy, Share, Edit2, Trash2, Database, Palette, Image as ImageIcon, Settings, UserRound, Lock, AtSign, Asterisk, Languages, Download, Camera, Underline, KeyRound, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import * as exifr from 'exifr';
import { StarActionOverlay } from './StarActionOverlay';
import { TrackActionOverlay } from './TrackActionOverlay';
import { NoteEditorModal } from './NoteEditorModal';
import { LoginWorldMapBackground } from './LoginWorldMapBackground';
import {
  FlyToTarget,
  MapEventHandlers,
  MapViewportSync,
  MapZoomTracker,
  StarNavigationOverlay,
} from './MapRuntimeComponents';
import { MapDataLayers } from './MapDataLayers';
import { PhotoGpsStarIcon } from './PhotoGpsStarIcon';
import { MapControlsOverlay, MapSearchButton, PhotoLocationToast, TrackingControlsOverlay } from './MapControlsOverlay';
import { SearchResultsScreen } from './SearchResultsScreen';
import { RecordsScreen } from './RecordsScreen';
import { HomeGalleryPanel, HomeProfilePanel, HomeThemePanel, type ThemeColorControl } from './HomePrimaryPanels';
import { HomeSettingsPanels, isHomeSettingsPanel, type SettingsMenuItem } from './HomeSettingsPanels';
import { TripStatisticsView, type MapActivityPoint, type TextRankingItem } from './TripStatisticsView';
import { isCloudBackendEnabled, supabaseConfigMessage, supabaseFunctionUrl } from './lib/supabaseClient';
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
import { sanitizeRichHtml, sanitizeRichHtmlFields } from './lib/htmlSanitizer';
import { normalizePersistedAppState } from './lib/appStateNormalize';
import {
  buildReadableExportHtml,
  exportImageSource,
  exportStoredImage,
  getInlineExportImageSources,
  hasImageExportError,
  type ExportedImageData,
} from './lib/exportReport';
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
  cleanReaderHtml,
  ensureReaderEditableTailAfterMedia,
  escapeHtml,
  extractImagesFromHtml,
  extractStoredImagesFromHtml,
  getLastReaderContentChild,
  getReadableNoteHtml,
  getReadableTitleHtml,
  getRemovedStoredImages,
  getStoredImagesFromNote,
  hasMeaningfulNoteContent,
  htmlToText,
  imageToReaderHtml,
  readerEditableTailHtml,
  readerNodeHasMeaningfulContent,
  uniqueStoredImages,
} from './lib/noteHtmlUtils';
import type {
  AppView,
  HomePanel,
  MapStyle,
  NoteData,
  PersistedAppState,
  RecordsCalendarMode,
  RecordsFilter,
  StarData,
  SystemTheme,
  TagMode,
  TrackData,
  TrackDraftData,
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
  SAMPLE_NOTE_IMAGE_URL,
  SAMPLE_NOTE_TEXT,
  TRACK_STALE_POSITION_GRACE_MS,
  UPLOAD_IMAGE_MAX_BYTES,
} from './constants/appDefaults';
import {
  DEFAULT_NAME_PREFIX,
  LANGUAGE_FONT_FAMILIES,
  LANGUAGE_FONT_SCALE,
  LANGUAGE_LOCALES,
  LANGUAGE_OPTIONS,
  LOGIN_LANGUAGE_LABELS,
} from './constants/language';
import {
  AUTO_USER_MANUAL_KEY_PREFIX,
  APP_STORAGE_KEY,
  TRACK_DRAFT_STORAGE_KEY_PREFIX,
} from './constants/storageKeys';
import {
  DEFAULT_SYSTEM_THEME,
  READER_FONT_SIZES,
  READER_TEXT_COLORS,
} from './constants/theme';
import {
  HOME_SETTINGS_ICON_SIZE,
  HOME_SETTINGS_ICON_STROKE,
  MAP_TOOL_ICON_STROKE,
  UI_ICON_STROKE,
} from './constants/ui';
import { HOME_COPY } from './copy/homeCopy';
import {
  getCloudSession,
  loadCloudAccountData,
  loginCloudAccount,
  normalizeAccountId,
  onCloudAuthStateChange,
  registerCloudAccount,
  saveCloudAppState,
  saveCloudProfile,
  signOutCloudAccount,
  updateCloudPassword,
  type CloudAuthAction,
  CloudAuthError,
  createCloudMcpToken,
  getCloudMcpEndpoint,
  listCloudMcpTokens,
  revokeCloudMcpToken,
  type CloudAppState,
  type CloudProfile,
  type CloudMcpTokenInfo,
} from './lib/cloudBackend';

function createLocationIcon(mapStyle: string, iconColor = '#c3c3c3', heading = 0) {
  const isAerial = mapStyle === 'aerial';
  const color = isAerial ? '#ffffff' : iconColor;
  const coneRotation = Number.isFinite(heading) ? heading + 90 : 90;
  
  return new L.DivIcon({
    className: 'app-location-div-icon',
    html: `
      <div class="app-location-marker" style="position: relative; width: 80px; height: 80px; pointer-events: none;">
          <svg width="80" height="80" viewBox="0 0 80 80" style="position: absolute; left: 0; top: 0; z-index: 1; transform: rotate(${coneRotation}deg); transform-origin: 40px 40px; transition: transform 160ms linear;">
              <defs>
                  <linearGradient id="coneGrad" gradientUnits="userSpaceOnUse" x1="40" y1="40" x2="8" y2="40">
                      <stop offset="0%" stop-color="${color}" stop-opacity="0.85" />
                      <stop offset="100%" stop-color="${color}" stop-opacity="0" />
                  </linearGradient>
              </defs>
              <path d="M 8 27 L 40 40 L 8 53 Z" fill="url(#coneGrad)" />
          </svg>
          <div style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; background: black; border: 5px solid ${color}; border-radius: 50%; z-index: 2; box-sizing: content-box; box-shadow: 0 2px 6px rgba(0,0,0,0.3); pointer-events: none;"></div>
      </div>
    `,
    iconSize: [80, 80],
    iconAnchor: [40, 40]
  });
}

type SearchField = 'coordinate' | 'text';

type EditingNoteTarget = {
  starId: string;
  noteId?: string;
};

type ReadingNoteTarget = {
  starId: string;
  noteId: string;
};

type DeviceOrientationEventWithCompass = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type DeviceOrientationEventConstructorWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<PermissionState>;
};

const cssColorToHex = (color: string, fallback = '#D2936D') => {
  if (!color) return fallback;
  if (color.startsWith('#')) return color;
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return fallback;
  return `#${[match[1], match[2], match[3]]
    .map(channel => Math.max(0, Math.min(255, Number(channel))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
};

const createClientId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 11)
);

const createDefaultRecordStar = (): StarData => {
  const timestamp = Date.now();
  return {
    id: DEFAULT_RECORD_STAR_ID,
    lat: DEFAULT_RECORD_STAR_LOCATION[0],
    lng: DEFAULT_RECORD_STAR_LOCATION[1],
    createdAt: timestamp,
    color: '#EDC727',
    notes: [{
      id: 'default-record-note',
      title: 'Today Note',
      titleHtml: 'Today Note',
      content: SAMPLE_NOTE_TEXT,
      contentHtml: [
        `<p>${SAMPLE_NOTE_TEXT}</p>`,
        '<figure class="note-inline-image" contenteditable="false" data-note-image="true">',
        `<img src="${SAMPLE_NOTE_IMAGE_URL}" alt="Note attachment" />`,
        '<button type="button" data-remove-image="true" aria-label="Remove image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>',
        '<button type="button" data-preview-image="true" aria-label="View larger image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></button>',
        '</figure>',
        '<p data-note-tail="true"></p>',
      ].join(''),
      imageUrl: undefined,
      imageUrls: undefined,
      fontSize: 18,
      titleFontSize: 18,
      createdAt: timestamp,
      updatedAt: timestamp,
      color: '#D2936D',
    }],
  };
};

const isMapStyle = (value: unknown): value is MapStyle => (
  value === 'light' || value === 'dark' || value === 'aerial'
);

const isLanguage = (value: unknown): value is 'en' | 'zh' | 'ko' => (
  typeof value === 'string' && LANGUAGE_OPTIONS.some(option => option.value === value)
);

const hasLoginAccount = (profile: UserProfile) => (
  profile.account.trim().length > 0
);

const getPersistableAvatarUrl = (profile?: Partial<UserProfile>) => (
  profile?.avatarImage ? storagePlaceholderSrc(profile.avatarImage) : profile?.avatarUrl || ''
);

const readPersistedAppState = (): PersistedAppState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? normalizePersistedAppState(sanitizeRichHtmlFields(parsed as PersistedAppState))
      : null;
  } catch {
    return null;
  }
};

const getAutoUserManualStorageKey = (account: string) => (
  `${AUTO_USER_MANUAL_KEY_PREFIX}${normalizeAccountId(account) || 'local'}`
);

const readAutoUserManualSeen = (account: string) => {
  if (typeof window === 'undefined') return true;

  try {
    return window.localStorage.getItem(getAutoUserManualStorageKey(account)) === 'seen';
  } catch {
    return true;
  }
};

const markAutoUserManualSeen = (account: string) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getAutoUserManualStorageKey(account), 'seen');
  } catch {
    // Manual auto-open is a convenience; storage failures should not block login.
  }
};

const getPublicProfileSnapshot = (profile?: Partial<UserProfile>): Partial<UserProfile> => ({
  name: profile?.name || '',
  account: profile?.account || '',
  avatarUrl: getPersistableAvatarUrl(profile),
  avatarImage: profile?.avatarImage,
});

const writePersistedAppState = (state: PersistedAppState) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(normalizePersistedAppState(sanitizeRichHtmlFields(state))));
  } catch {
    // Storage can fail when image-heavy notes exceed the browser quota.
  }
};

const getTrackDraftStorageKey = (account: string) => (
  `${TRACK_DRAFT_STORAGE_KEY_PREFIX}${normalizeAccountId(account) || 'local'}`
);

const isValidTrackDraftPoint = (value: unknown): value is [number, number] => (
  Array.isArray(value) &&
  value.length >= 2 &&
  Number.isFinite(Number(value[0])) &&
  Number.isFinite(Number(value[1])) &&
  Number(value[0]) >= -90 &&
  Number(value[0]) <= 90 &&
  Number(value[1]) >= -180 &&
  Number(value[1]) <= 180
);

const normalizeTrackDraftPaths = (value: unknown): [number, number][][] => (
  Array.isArray(value)
    ? value
        .map(segment => (
          Array.isArray(segment)
            ? segment
                .map(point => isValidTrackDraftPoint(point) ? [Number(point[0]), Number(point[1])] as [number, number] : null)
                .filter((point): point is [number, number] => Boolean(point))
            : []
        ))
        .filter(segment => segment.length > 0)
    : []
);

const readTrackDraft = (account: string): TrackDraftData | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(getTrackDraftStorageKey(account));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrackDraftData>;
    const paths = normalizeTrackDraftPaths(parsed.paths);
    if (paths.length === 0) return null;
    return {
      paths,
      time: Math.max(0, Number(parsed.time) || 0),
      savedAt: Math.max(0, Number(parsed.savedAt) || Date.now()),
    };
  } catch {
    return null;
  }
};

const writeTrackDraft = (account: string, draft: TrackDraftData) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getTrackDraftStorageKey(account), JSON.stringify(draft));
  } catch {
    // A route draft is only a recovery aid; storage quota errors should not stop tracking.
  }
};

const clearTrackDraft = (account: string) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(getTrackDraftStorageKey(account));
  } catch {
    // Ignore local cleanup failures.
  }
};

const canUseBrowserGeolocation = () => (
  typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
);

const getCompassHeading = (event: DeviceOrientationEventWithCompass) => {
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) {
    return (event.webkitCompassHeading + 360) % 360;
  }

  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return (360 - event.alpha + 360) % 360;
  }

  return null;
};

const getNearbyDefaultStarLocation = (point: [number, number]): [number, number] => {
  const northMeters = 80;
  const eastMeters = 80;
  const latDelta = northMeters / 111320;
  const lngDelta = eastMeters / (111320 * Math.max(0.01, Math.cos(point[0] * Math.PI / 180)));
  return [point[0] + latDelta, point[1] + lngDelta];
};

const isNearCoordinate = (lat: number, lng: number, target: [number, number], tolerance = 0.002) => (
  Math.abs(lat - target[0]) <= tolerance && Math.abs(lng - target[1]) <= tolerance
);

const normalizeInitialStars = (stars?: StarData[]) => {
  if (!Array.isArray(stars) || stars.length === 0) return null;

  return stars.map(star => (
    star.id === DEFAULT_RECORD_STAR_ID && isNearCoordinate(star.lat, star.lng, LEGACY_RECORD_STAR_LOCATION)
      ? { ...star, lat: DEFAULT_RECORD_STAR_LOCATION[0], lng: DEFAULT_RECORD_STAR_LOCATION[1] }
      : star
  ));
};

const canvasToImageBlob = (canvas: HTMLCanvasElement, mimeType: string, quality: number) => (
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Could not compress image.'));
    }, mimeType, quality);
  })
);

const imageBlobToDataUrl = (blob: Blob) => (
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  })
);

type NavigatorWithFileShare = Navigator & {
  canShare?: (data: { files?: File[]; title?: string }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
};

const getImageExtension = (mimeType: string) => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpg';
};

const getImageDownloadFileName = (title: string, mimeType = 'image/jpeg') => {
  const baseName = title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${baseName}.${getImageExtension(mimeType)}`;
};

const loadImageFile = (file: File) => (
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image.'));
    };
    image.src = objectUrl;
  })
);

const compressImageFileToDataUrl = async (file: File) => {
  const image = await loadImageFile(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is not available.');

  const maxDimension = 900;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  let quality = 0.8;
  let lastBlob: Blob | null = null;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToImageBlob(canvas, 'image/jpeg', quality);
    lastBlob = blob;
    if (blob.size <= UPLOAD_IMAGE_MAX_BYTES) return imageBlobToDataUrl(blob);

    if (quality > 0.42) {
      quality = Math.max(0.42, quality - 0.12);
    } else {
      width = Math.max(220, Math.round(width * 0.84));
      height = Math.max(220, Math.round(height * 0.84));
      quality = 0.72;
    }
  }

  if (!lastBlob) throw new Error('Could not compress image.');
  return imageBlobToDataUrl(lastBlob);
};

const dataUrlToFile = async (dataUrl: string, fileName: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
};

const TIFF_TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
};

type TiffEntry = {
  type: number;
  count: number;
  valueOffset: number;
  entryOffset: number;
};

const readExifGpsFromArrayBuffer = (buffer: ArrayBuffer): [number, number] | null => {
  const view = new DataView(buffer);
  if (view.byteLength < 14 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = view.getUint16(offset + 2, false);
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + segmentLength;

    if (
      marker === 0xe1 &&
      segmentStart + 14 < view.byteLength &&
      view.getUint8(segmentStart) === 0x45 &&
      view.getUint8(segmentStart + 1) === 0x78 &&
      view.getUint8(segmentStart + 2) === 0x69 &&
      view.getUint8(segmentStart + 3) === 0x66
    ) {
      const tiffStart = segmentStart + 6;
      const byteOrder = view.getUint16(tiffStart, false);
      const littleEndian = byteOrder === 0x4949;
      if (!littleEndian && byteOrder !== 0x4d4d) return null;
      if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return null;

      const readIfd = (ifdOffset: number) => {
        const entries = new Map<number, TiffEntry>();
        const absoluteOffset = tiffStart + ifdOffset;
        if (absoluteOffset < tiffStart || absoluteOffset + 2 > view.byteLength) return entries;
        const count = view.getUint16(absoluteOffset, littleEndian);
        for (let index = 0; index < count; index += 1) {
          const entryOffset = absoluteOffset + 2 + index * 12;
          if (entryOffset + 12 > view.byteLength) break;
          const tag = view.getUint16(entryOffset, littleEndian);
          entries.set(tag, {
            type: view.getUint16(entryOffset + 2, littleEndian),
            count: view.getUint32(entryOffset + 4, littleEndian),
            valueOffset: view.getUint32(entryOffset + 8, littleEndian),
            entryOffset,
          });
        }
        return entries;
      };

      const entryValueOffset = (entry?: TiffEntry) => {
        if (!entry) return -1;
        const byteLength = (TIFF_TYPE_SIZES[entry.type] || 1) * entry.count;
        return byteLength <= 4 ? entry.entryOffset + 8 : tiffStart + entry.valueOffset;
      };

      const readAscii = (entry?: TiffEntry) => {
        const valueOffset = entryValueOffset(entry);
        if (!entry || valueOffset < 0 || valueOffset + entry.count > view.byteLength) return '';
        let value = '';
        for (let index = 0; index < entry.count; index += 1) {
          const code = view.getUint8(valueOffset + index);
          if (code === 0) break;
          value += String.fromCharCode(code);
        }
        return value.trim();
      };

      const readRationalArray = (entry?: TiffEntry) => {
        const valueOffset = entryValueOffset(entry);
        if (!entry || valueOffset < 0 || valueOffset + entry.count * 8 > view.byteLength) return [];
        const values: number[] = [];
        for (let index = 0; index < entry.count; index += 1) {
          const numerator = view.getUint32(valueOffset + index * 8, littleEndian);
          const denominator = view.getUint32(valueOffset + index * 8 + 4, littleEndian);
          values.push(denominator ? numerator / denominator : 0);
        }
        return values;
      };

      const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
      const ifd0 = readIfd(firstIfdOffset);
      const gpsIfdPointer = ifd0.get(0x8825);
      if (!gpsIfdPointer) return null;
      const gpsIfd = readIfd(gpsIfdPointer.valueOffset);
      const latRef = readAscii(gpsIfd.get(0x0001));
      const latValues = readRationalArray(gpsIfd.get(0x0002));
      const lngRef = readAscii(gpsIfd.get(0x0003));
      const lngValues = readRationalArray(gpsIfd.get(0x0004));
      if (latValues.length < 3 || lngValues.length < 3) return null;

      const toDecimal = (values: number[], ref: string) => {
        const decimal = values[0] + values[1] / 60 + values[2] / 3600;
        return ['S', 'W'].includes(ref.toUpperCase()) ? -decimal : decimal;
      };

      const lat = toDecimal(latValues, latRef);
      const lng = toDecimal(lngValues, lngRef);
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? [lat, lng]
        : null;
    }

    if (segmentLength < 2 || segmentEnd <= offset) break;
    offset = segmentEnd;
  }

  return null;
};

const readPhotoGpsCoordinates = async (file: File): Promise<[number, number] | null> => {
  try {
    const gps = await exifr.gps(file);
    if (
      gps &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude) &&
      Math.abs(gps.latitude) <= 90 &&
      Math.abs(gps.longitude) <= 180
    ) {
      return [gps.latitude, gps.longitude];
    }
  } catch {
    // Fall back to the lightweight JPEG parser below.
  }

  try {
    const buffer = await file.arrayBuffer();
    return readExifGpsFromArrayBuffer(buffer);
  } catch {
    return null;
  }
};

const deleteStoredImages = (metadataList: StoredImageMetadata[]) => {
  uniqueStoredImages(metadataList).forEach(metadata => {
    void deleteImageFromStorageReliably(metadata);
  });
};

const countSearchMatches = (text: string, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  let count = 0;
  let cursor = 0;
  const lowerText = text.toLowerCase();
  let matchIndex = lowerText.indexOf(normalizedQuery, cursor);

  while (matchIndex >= 0) {
    count += 1;
    cursor = matchIndex + normalizedQuery.length;
    matchIndex = lowerText.indexOf(normalizedQuery, cursor);
  }

  return count;
};

const parseCoordinateSearch = (value: string): [number, number] | null => {
  const match = value.trim().match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
};

const getNoteTimestamp = (note: NoteData) => {
  const candidate = note.createdAt || Number(note.id) || note.updatedAt;
  return Number.isFinite(candidate) && candidate > 0 ? candidate : Date.now();
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
  const [readerActiveTextTarget, setReaderActiveTextTarget] = useState<'title' | 'content'>('content');
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
  const manualIconGuide = [
    { icon: <MapIcon size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.bottomMap, body: homeCopy.manualIconMap },
    { icon: <PieChart size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.bottomStats, body: homeCopy.manualIconStats },
    { icon: <BookOpen size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.bottomNotes, body: homeCopy.manualIconRecords },
    { icon: <Home size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.bottomHome, body: homeCopy.manualIconHome },
    { icon: <Star size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.starLabel, body: homeCopy.manualIconStar },
    { icon: <MapPin size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.openPermissions, body: homeCopy.manualIconLocation },
    { icon: <Route size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.manualSections[3].title, body: homeCopy.manualIconRoute },
    { icon: <Camera size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.readerAddPhoto, body: homeCopy.manualIconCamera },
    { icon: <PhotoGpsStarIcon size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.uploadPhotoLocation, body: homeCopy.manualIconPhotoGps },
    { icon: <Save size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.readerEdit, body: homeCopy.manualIconSave },
    { icon: <Copy size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.manualIconCopy, body: homeCopy.manualIconCopy },
    { icon: <Share size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.manualIconShare, body: homeCopy.manualIconShare },
    { icon: <Search size={18} strokeWidth={UI_ICON_STROKE} />, label: homeCopy.search, body: homeCopy.manualIconSearch },
  ];
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
      const exportedAt = new Date().toISOString();
      const locations = await Promise.all(stars.map(async (star, starIndex) => {
        const notes = await Promise.all((star.notes || []).map(async (note, noteIndex) => {
          if (!hasMeaningfulNoteContent(note)) return null;
          const timestamp = getNoteTimestamp(note);
          const storedImages = await Promise.all(
            getStoredImagesFromNote(note).map((metadata, imageIndex) => (
              exportStoredImage(metadata, `locations.${starIndex}.notes.${noteIndex}.images.${imageIndex}`)
            ))
          );
          const inlineImages = await Promise.all(
            getInlineExportImageSources(note).map((src, imageIndex) => (
              exportImageSource(src, `locations.${starIndex}.notes.${noteIndex}.inlineImages.${imageIndex}`)
            ))
          );
          const images = [
            ...storedImages,
            ...inlineImages.filter((image): image is ExportedImageData => Boolean(image)),
          ];

          return {
            title: htmlToText(note.titleHtml) || note.title || `${homeCopy.noteLabel} ${noteIndex + 1}`,
            text: htmlToText(note.contentHtml) || note.content || '',
            timestamp,
            images,
          };
        }));

        return {
          index: starIndex + 1,
          lat: star.lat,
          lng: star.lng,
          createdAt: star.createdAt || null,
          notes: notes.filter((note): note is NonNullable<typeof note> => Boolean(note)),
        };
      }));

      const readableLocations = locations.filter(location => location.notes.length > 0);
      const html = buildReadableExportHtml({
        appName: 'My Life Memory',
        account: normalizeAccountId(profile.account),
        profileName: profile.name,
        exportedAt,
        locale: languageLocale,
        locations: readableLocations,
      });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const accountSlug = normalizeAccountId(profile.account) || 'user';
      const dateSlug = exportedAt.slice(0, 10);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `my-life-memory-${accountSlug}-${dateSlug}.html`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setExportDataStatus(hasImageExportError(readableLocations) ? homeCopy.exportDataPartial : homeCopy.exportDataReady);
    } catch (error) {
      console.error('Could not export user data:', error);
      setExportDataStatus(homeCopy.exportDataFailed);
    } finally {
      setIsExportingData(false);
    }
  };

  const homeMenuItems: { panel: Extract<HomePanel, 'profile' | 'theme' | 'gallery' | 'settings'>; label: string; icon: React.ReactNode }[] = [
    { panel: 'profile', label: homeCopy.modify, icon: <Database size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'theme', label: homeCopy.theme, icon: <Palette size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'gallery', label: homeCopy.gallery, icon: <ImageIcon size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'settings', label: homeCopy.settings, icon: <Settings size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
  ];
  const settingsSubpageTitles: Partial<Record<Exclude<HomePanel, null>, string>> = {
    language: homeCopy.language,
    permissions: homeCopy.openPermissionsHint,
    manual: homeCopy.userManual,
    apiSecurity: homeCopy.apiSecurity,
    mcp: homeCopy.mcpAccess,
    export: homeCopy.exportData,
  };
  const activeHomeTitle = settingsSubpageTitles[activeHomePanel] ||
    homeMenuItems.find(item => item.panel === activeHomePanel)?.label ||
    homeCopy.settings;
  const cloudMcpEndpoint = getCloudMcpEndpoint();
  const cloudMemoryApiEndpoint = supabaseFunctionUrl('memory-api');
  const mcpHeaderValue = mcpPlainToken ? `Bearer ${mcpPlainToken}` : homeCopy.mcpHeaderValueHint;
  const apiSecurityCards = [
    { title: homeCopy.apiMemoryApiTitle, body: homeCopy.apiMemoryApiBody },
    { title: homeCopy.apiMcpSecurityTitle, body: homeCopy.apiMcpSecurityBody },
    { title: homeCopy.apiTokenSecurityTitle, body: homeCopy.apiTokenSecurityBody },
    { title: homeCopy.apiStorageSecurityTitle, body: homeCopy.apiStorageSecurityBody },
    { title: homeCopy.apiDirectApiTitle, body: homeCopy.apiDirectApiBody },
    { title: homeCopy.apiNeverExposeTitle, body: homeCopy.apiNeverExposeBody },
  ];
  const themeColorControls: ThemeColorControl[] = [
    { key: 'page', label: homeCopy.base },
    { key: 'card', label: homeCopy.card },
    { key: 'icon', label: homeCopy.icon },
    { key: 'dark', label: homeCopy.dark },
  ];
  const settingsMenuItems: SettingsMenuItem[] = [
    { panel: 'language', label: homeCopy.language, icon: <Languages size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'permissions', label: homeCopy.openPermissionsHint, icon: <MapPin size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'manual', label: homeCopy.userManual, icon: <BookOpen size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
    { panel: 'apiSecurity', label: homeCopy.apiSecurity, icon: <ShieldCheck size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />, hidden: !isCloudBackendEnabled },
    { panel: 'mcp', label: homeCopy.mcpAccess, icon: <KeyRound size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />, hidden: !isCloudBackendEnabled },
    { panel: 'export', label: homeCopy.exportData, icon: <Download size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} /> },
  ];

  const getBottomNavClass = (view: AppView) => (
    activeView === view
      ? 'bg-[var(--app-dark)] text-white rounded-full px-6 py-3 flex items-center justify-center transition-all duration-300 ease-out'
      : 'text-gray-800 rounded-full px-4 py-3 flex items-center justify-center hover:bg-[var(--app-card)] transition-all duration-300 ease-out'
  );
  const bottomNavTransition = { type: 'spring', stiffness: 420, damping: 34 };

  const screenTopPaddingClass = 'pt-16';
  const btnClass = "w-12 h-12 rounded-full bg-[var(--app-icon)] flex items-center justify-center text-black hover:brightness-95 transition-all shadow-sm";
  const starPlacementButtonClass = `${btnClass} touch-none`;
  const readerToolButtonClass = "flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-md transition-transform active:scale-95";
  const searchInputClass = (field: SearchField) => (
    `h-12 rounded-full px-5 text-[15px] font-medium text-black outline-none transition-colors placeholder:text-black/25 ${
      activeSearchField === field ? 'bg-[var(--app-active-surface)] shadow-sm' : 'bg-[var(--app-card)]'
    }`
  );

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

  const readerRangeIsInsideElement = React.useCallback((range: Range, element: HTMLElement | null) => (
    Boolean(element && element.contains(range.commonAncestorContainer))
  ), []);

  const getReaderCaretRangeFromPoint = React.useCallback((clientX: number, clientY: number) => {
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    if (documentWithCaret.caretPositionFromPoint) {
      const position = documentWithCaret.caretPositionFromPoint(clientX, clientY);
      if (!position) return null;
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }

    return documentWithCaret.caretRangeFromPoint?.(clientX, clientY) || null;
  }, []);

  const readerRangeStartsInsideNonEditable = React.useCallback((range: Range, element: HTMLElement | null) => {
    const parentElement = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const nonEditable = parentElement?.closest('[contenteditable="false"], [data-note-image="true"], button');
    return Boolean(element && nonEditable && element.contains(nonEditable));
  }, []);

  const moveReaderCaretToContentEnd = React.useCallback(() => {
    const editor = readerContentRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return false;

    ensureReaderEditableTailAfterMedia(editor);
    const lastChild = getLastReaderContentChild(editor);
    const range = document.createRange();
    editor.focus();

    if (
      lastChild instanceof HTMLElement &&
      ['P', 'DIV', 'LI', 'BLOCKQUOTE'].includes(lastChild.tagName)
    ) {
      if (!readerNodeHasMeaningfulContent(lastChild)) {
        range.setStart(lastChild, 0);
      } else {
        range.selectNodeContents(lastChild);
      }
    } else {
      range.selectNodeContents(editor);
    }

    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    readerSavedRangeRef.current = range.cloneRange();
    return true;
  }, []);

  const moveReaderCaretToPoint = React.useCallback((clientX: number, clientY: number) => {
    const editor = readerContentRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return false;

    ensureReaderEditableTailAfterMedia(editor);
    const range = getReaderCaretRangeFromPoint(clientX, clientY);
    if (
      !range ||
      !readerRangeIsInsideElement(range, editor) ||
      readerRangeStartsInsideNonEditable(range, editor) ||
      (range.startContainer === editor && editor.childNodes.length > 0)
    ) {
      return false;
    }

    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    readerSavedRangeRef.current = range.cloneRange();
    return true;
  }, [getReaderCaretRangeFromPoint, readerRangeIsInsideElement, readerRangeStartsInsideNonEditable]);

  const getReaderElementForTarget = React.useCallback((target: 'title' | 'content') => (
    target === 'title' ? readerTitleRef.current : readerContentRef.current
  ), []);

  const getReaderTargetFromRange = React.useCallback((range: Range): 'title' | 'content' | null => {
    if (readerRangeIsInsideElement(range, readerTitleRef.current)) return 'title';
    if (readerRangeIsInsideElement(range, readerContentRef.current)) return 'content';
    return null;
  }, [readerRangeIsInsideElement]);

  const normalizeReaderFontSize = (fontSize: number) => {
    const roundedSize = Math.round(fontSize);
    return READER_FONT_SIZES.find(size => Math.abs(size - roundedSize) <= 1) || roundedSize;
  };

  const getReaderTextNodeInRange = React.useCallback((range: Range, element: HTMLElement) => {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: node => {
          if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
          const parentElement = node.parentElement;
          if (parentElement?.closest('[contenteditable="false"], [data-note-image="true"], button')) {
            return NodeFilter.FILTER_REJECT;
          }
          return range.intersectsNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );
    return walker.nextNode();
  }, []);

  const getReaderComputedElement = (node: Node | null, element: HTMLElement) => {
    if (!node) return element;
    const candidate = node.nodeType === Node.ELEMENT_NODE
      ? node as Element
      : node.parentElement;
    return candidate instanceof HTMLElement && element.contains(candidate) ? candidate : element;
  };

  const getReaderUnderlineFromElement = (element: HTMLElement) => {
    const decorationLine = window.getComputedStyle(element).textDecorationLine;
    return decorationLine.includes('underline') || Boolean(element.closest('u'));
  };

  const syncReaderToolbarFromRange = React.useCallback((range: Range) => {
    const target = getReaderTargetFromRange(range);
    if (!target) return;
    const element = getReaderElementForTarget(target);
    if (!element) return;
    const textNode = range.collapsed ? range.startContainer : getReaderTextNodeInRange(range, element);
    const computedElement = getReaderComputedElement(textNode, element);
    const computedStyle = window.getComputedStyle(computedElement);
    const fontSize = Number.parseFloat(computedStyle.fontSize);
    setReaderActiveTextTarget(target);
    setReaderSelectedFontSize(Number.isFinite(fontSize) ? normalizeReaderFontSize(fontSize) : 18);
    setReaderSelectedColor(cssColorToHex(computedStyle.color, readerRecord?.note.color || '#D2936D'));
    setReaderSelectedUnderline(getReaderUnderlineFromElement(computedElement));
  }, [getReaderElementForTarget, getReaderTargetFromRange, getReaderTextNodeInRange, readerRecord?.note.color]);

  const saveReaderSelection = React.useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const target = getReaderTargetFromRange(range);
    if (!target) return;
    readerSavedRangeRef.current = range.cloneRange();
    syncReaderToolbarFromRange(range);
  }, [getReaderTargetFromRange, syncReaderToolbarFromRange]);

  const restoreReaderRange = React.useCallback((element: HTMLElement, range: Range) => {
    const selection = window.getSelection();
    if (!selection || !readerRangeIsInsideElement(range, element)) return false;
    element.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    readerSavedRangeRef.current = range.cloneRange();
    return true;
  }, [readerRangeIsInsideElement]);

  const getReaderSelectionRange = React.useCallback((target = readerActiveTextTarget) => {
    const element = getReaderElementForTarget(target);
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (readerRangeIsInsideElement(range, element)) return range.cloneRange();
    }
    const savedRange = readerSavedRangeRef.current;
    if (savedRange && readerRangeIsInsideElement(savedRange, element)) return savedRange.cloneRange();
    return null;
  }, [getReaderElementForTarget, readerActiveTextTarget, readerRangeIsInsideElement]);

  const splitReaderRangeTextBoundaries = (range: Range) => {
    if (
      range.startContainer === range.endContainer &&
      range.startContainer.nodeType === Node.TEXT_NODE
    ) {
      const textNode = range.startContainer as Text;
      const startOffset = range.startOffset;
      const endOffset = range.endOffset;
      textNode.splitText(endOffset);
      const selectedText = textNode.splitText(startOffset);
      range.setStart(selectedText, 0);
      range.setEnd(selectedText, selectedText.length);
      return;
    }

    if (
      range.endContainer.nodeType === Node.TEXT_NODE &&
      range.endOffset > 0 &&
      range.endOffset < (range.endContainer.textContent?.length || 0)
    ) {
      (range.endContainer as Text).splitText(range.endOffset);
    }

    if (
      range.startContainer.nodeType === Node.TEXT_NODE &&
      range.startOffset > 0 &&
      range.startOffset < (range.startContainer.textContent?.length || 0)
    ) {
      const selectedStart = (range.startContainer as Text).splitText(range.startOffset);
      range.setStart(selectedStart, 0);
    }
  };

  const applyReaderStyleToSelection = React.useCallback((styles: Record<string, string>) => {
    const target = readerActiveTextTarget;
    const element = getReaderElementForTarget(target);
    const range = getReaderSelectionRange(target);
    const selection = window.getSelection();
    if (!element || !range || !selection || !readerRangeIsInsideElement(range, element)) return false;

    if (range.collapsed) {
      const pendingRef = target === 'title' ? readerPendingTitleStylesRef : readerPendingContentStylesRef;
      pendingRef.current = { ...pendingRef.current, ...styles };
      restoreReaderRange(element, range);
      return true;
    }

    const workingRange = range.cloneRange();
    splitReaderRangeTextBoundaries(workingRange);

    const selectedTextNodes: Text[] = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: node => {
          if (!node.textContent) return NodeFilter.FILTER_REJECT;
          const parentElement = node.parentElement;
          if (parentElement?.closest('[contenteditable="false"], [data-note-image="true"], button')) {
            return NodeFilter.FILTER_REJECT;
          }
          return workingRange.intersectsNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    while (walker.nextNode()) {
      selectedTextNodes.push(walker.currentNode as Text);
    }

    if (selectedTextNodes.length === 0) return false;
    const styledNodes = selectedTextNodes.map(textNode => {
      const span = document.createElement('span');
      Object.entries(styles).forEach(([property, value]) => {
        span.style.setProperty(property, value);
      });
      textNode.replaceWith(span);
      span.appendChild(textNode);
      return span;
    });

    element.focus();
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartBefore(styledNodes[0]);
    newRange.setEndAfter(styledNodes[styledNodes.length - 1]);
    selection.addRange(newRange);
    readerSavedRangeRef.current = newRange.cloneRange();
    return true;
  }, [getReaderElementForTarget, getReaderSelectionRange, readerActiveTextTarget, readerRangeIsInsideElement, restoreReaderRange]);

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
    element: HTMLElement,
    range: Range | null,
    text: string,
    styles: Record<string, string>
  ) => {
    if (!range || !range.collapsed || !readerRangeIsInsideElement(range, element)) return false;
    const span = document.createElement('span');
    Object.entries(styles).forEach(([property, value]) => {
      span.style.setProperty(property, value);
    });
    span.textContent = text;
    range.deleteContents();
    range.insertNode(span);
    const selection = window.getSelection();
    if (selection) {
      const nextRange = document.createRange();
      nextRange.setStartAfter(span);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
      readerSavedRangeRef.current = nextRange.cloneRange();
    }
    return true;
  }, [readerRangeIsInsideElement]);

  const handleReaderBeforeInput = React.useCallback((target: 'title' | 'content', event: React.FormEvent<HTMLElement>) => {
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
      
      {/* Background Map */}
      <div className={`absolute inset-0 z-0 bg-[#e5e5e5] ${mapStyle === 'dark' ? 'theme-dark' : ''} ${mapStyle === 'light' ? 'theme-light' : ''}`}>
        <MapContainer 
          center={position} 
          zoom={16} 
          scrollWheelZoom={true} 
          className="w-full h-full absolute inset-0 z-0"
          zoomControl={false} // Disable default zoom control to match UI
        >
          <TileLayer
            attribution={mapTiles[mapStyle].attribution}
            url={mapTiles[mapStyle].url}
          />
          <Marker 
            position={userLocation} 
            icon={locationIcon}
            draggable={false}
            keyboard={false}
            interactive={false}
          />
          <FlyToTarget target={flyTarget} />
          <MapViewportSync location={userLocation} shouldFollow={false} />
          <MapZoomTracker onZoomChange={setMapZoom} />
          
          <MapEventHandlers onDrop={handleMapDrop} onMapClick={onMapClick} onMapReady={handleMapReady} />
          
          <StarNavigationOverlay activeTag={activeTag} stars={stars} onPrev={handlePrevTag} onNext={handleNextTag} />
          <StarActionOverlay
            selectedStarId={selectedStarId}
            stars={stars}
            onUpdateStar={onUpdateStar}
            onDeleteStar={onDeleteStar}
            onEditNote={starId => setEditingNoteTarget({ starId })}
            language={language}
          />
          <TrackActionOverlay selectedTrackId={selectedTrackId} savedTracks={savedTracks} onUpdateTrack={onUpdateTrack} onDeleteTrack={onDeleteTrack} selectedLatLng={selectedTrackLatLng} language={language} />
          <MapDataLayers
            tagPolylines={tagPolylines}
            isTracking={isTracking}
            trackPaths={trackPaths}
            savedTracks={savedTracks}
            showRouteDetailDots={showRouteDetailDots}
            stars={stars}
            selectedStarId={selectedStarId}
            mapStyle={mapStyle}
            badgeColor={systemTheme.icon}
            onSelectTrack={(trackId, latLng) => {
              setSelectedTrackId(trackId);
              if (latLng) setSelectedTrackLatLng(latLng);
            }}
            onSelectStar={onStarClick}
            onMoveStar={onMoveStar}
          />
        </MapContainer>
      </div>

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

      <AnimatePresence>
        {activeView === 'home' && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            transition={{ duration: 0.18 }}
            className="home-screen absolute inset-0 z-[900] flex justify-center overflow-hidden bg-[var(--app-page)] pointer-events-auto"
          >
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarInput}
            />

            <div ref={homeScrollRef} className={`relative h-full w-full max-w-[430px] overflow-y-auto px-10 pb-28 ${screenTopPaddingClass}`}>
              {!isSignedIn ? (
                <>
                <LoginWorldMapBackground />
                <div className="absolute right-3 top-4 z-20 flex rounded-full bg-[var(--app-card)] p-1 shadow-sm">
                  {LANGUAGE_OPTIONS.map(option => (
                    <button
                      type="button"
                      key={option.value}
                      onClick={() => setLanguage(option.value)}
                      className={`h-8 min-w-8 rounded-full px-2 text-[12px] font-semibold transition-colors ${language === option.value ? 'bg-[var(--app-dark)] text-white' : 'text-black/55'}`}
                      aria-label={option.label}
                    >
                      {LOGIN_LANGUAGE_LABELS[option.value] || option.label}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={authMode === 'register' ? handleRegister : handleLogin}
                  className="relative z-10 flex min-h-full flex-col items-center justify-center"
                >
                  <div className="relative flex w-full flex-col items-center">
                    <div className="relative z-10 mb-8 w-full text-center">
                      <h1 className="app-display-title text-[36px] font-bold leading-none text-black">
                        My life memory
                      </h1>
                    </div>
                    <div className="relative z-10 w-full rounded-[18px] bg-[var(--app-card)] p-4">
                    <div className="mb-4 flex items-center gap-2 text-[18px] font-medium text-black">
                      <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} />
                      {authMode === 'register' ? homeCopy.registerTitle : homeCopy.loginTitle}
                    </div>
                    <div className="mb-4 text-[15px] font-medium leading-tight text-black/45">
                      {authMode === 'register' ? homeCopy.registerHint : homeCopy.loginHint}
                    </div>
                    {cloudConfigError && (
                      <div className="mb-4 rounded-[12px] bg-black/8 px-3 py-2 text-[12px] leading-5 text-black/65">
                        {homeCopy.cloudConfigInvalid}
                      </div>
                    )}
                    <div className="space-y-3">
                      <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                        <AtSign size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                        <input
                          value={loginAccount}
                          onChange={event => {
                            setLoginAccount(event.target.value);
                            setLoginError('');
                            setIsPasswordRevealed(false);
                          }}
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                          placeholder={homeCopy.account}
                        />
                      </label>
                      <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                        <Lock size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                        <input
                          value={loginPassword}
                          onChange={event => {
                            setLoginPassword(event.target.value);
                            setLoginError('');
                            setIsPasswordRevealed(false);
                          }}
                          type="password"
                          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                          placeholder={authMode === 'register' ? homeCopy.registerPassword : homeCopy.loginPassword}
                        />
                      </label>
                      {authMode === 'register' && (
                        <label className="flex h-11 items-center gap-3 rounded-[12px] bg-[var(--app-soft-surface)] px-3 text-black">
                          <Asterisk size={HOME_SETTINGS_ICON_SIZE} strokeWidth={HOME_SETTINGS_ICON_STROKE} className="shrink-0" />
                          <input
                            value={registerInviteCode}
                            onChange={event => {
                              setRegisterInviteCode(event.target.value);
                              setLoginError('');
                            }}
                            type="password"
                            autoComplete="off"
                            className="min-w-0 flex-1 bg-transparent text-[16px] font-medium outline-none placeholder:text-black/30"
                            placeholder={homeCopy.inviteCode}
                          />
                        </label>
                      )}
                    </div>
                    {loginError && (
                      <div className="mt-3 text-[13px] font-medium text-black/45">
                        {loginError}
                      </div>
                    )}
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <button
                        type="submit"
                        disabled={isAuthBusy}
                        onClick={event => {
                          if (authMode !== 'login') {
                            event.preventDefault();
                          }
                          setAuthMode('login');
                          setRegisterInviteCode('');
                        }}
                        className="h-[48px] rounded-full bg-[var(--app-dark)] text-[16px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
                      >
                        {isAuthBusy && authMode === 'login' ? homeCopy.loggingIn : homeCopy.login}
                      </button>
                      <button
                        type="button"
                        disabled={isAuthBusy}
                        onClick={event => {
                          if (authMode !== 'register') {
                            setAuthMode('register');
                            setLoginError('');
                            setIsPasswordRevealed(false);
                            return;
                          }
                          void handleRegister(event);
                        }}
                        className="h-[48px] rounded-full bg-[var(--app-soft-surface)] text-[16px] font-medium text-black transition-transform active:scale-[0.98] disabled:opacity-60"
                      >
                        {isAuthBusy && authMode === 'register' ? homeCopy.registering : homeCopy.register}
                      </button>
                    </div>
                    </div>
                  </div>
                </form>
                </>
              ) : !activeHomePanel && (
                <>
              <div className="flex items-center gap-8">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] bg-[var(--app-card)] text-black"
                  aria-label={homeCopy.uploadAvatar}
                >
                  {profileAvatarSrc ? (
                    <img src={profileAvatarSrc} alt={homeCopy.userAvatarAlt} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[var(--app-card)]">
                      <UserRound size={42} strokeWidth={UI_ICON_STROKE} />
                    </div>
                  )}
                </button>

                <div className="min-w-0">
                  <div className="truncate text-[26px] font-semibold leading-tight text-black">{profile.name || homeCopy.userFallback}</div>
                  <div className="mt-1.5 text-[14px] font-medium leading-tight text-black">ID:{profile.account || '----'}</div>
                </div>
              </div>

              <div className="mt-14 space-y-2.5">
                {homeMenuItems.map(item => (
                  <button
                    key={item.panel}
                    onClick={() => setActiveHomePanel(item.panel)}
                    className="flex h-[58px] w-full items-center rounded-[14px] bg-[var(--app-card)] px-4 text-left text-black transition-transform active:scale-[0.99]"
                  >
                    <span className="mr-4 flex shrink-0 items-center justify-center text-black">{item.icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[18px] font-medium leading-tight">{item.label}</span>
                    <ChevronRight
                      size={28}
                      strokeWidth={UI_ICON_STROKE}
                      className="ml-3 text-black/15"
                    />
                  </button>
                ))}
              </div>
                </>
              )}

              {isSignedIn && activeHomePanel && (
                <button
                  type="button"
                  onClick={closeHomePanel}
                  className="mb-5 isolate flex h-11 items-center gap-2 overflow-hidden rounded-full bg-[var(--app-card)] px-4 text-[18px] font-medium text-black no-underline outline-none"
                  aria-label={homeCopy.back}
                >
                  <ChevronLeft size={24} strokeWidth={UI_ICON_STROKE} />
                  <span className="block translate-y-[-1px] leading-none no-underline [text-decoration:none]">{activeHomeTitle}</span>
                </button>
              )}

              <AnimatePresence mode="wait">
                {isSignedIn && activeHomePanel === 'profile' && (
                  <HomeProfilePanel
                    homeCopy={homeCopy}
                    profile={profile}
                    profileAvatarSrc={profileAvatarSrc}
                    isCloudBackendEnabled={isCloudBackendEnabled}
                    isPasswordRevealed={isPasswordRevealed}
                    passwordChangeStatus={passwordChangeStatus}
                    onAvatarClick={() => avatarInputRef.current?.click()}
                    onProfileNameChange={name => setProfile(prev => ({ ...prev, name }))}
                    onProfilePasswordChange={password => setProfile(prev => ({ ...prev, password }))}
                    onOpenPasswordChange={() => {
                      setIsPasswordChangeOpen(true);
                      setPasswordChangeStatus('');
                    }}
                    onTogglePasswordReveal={() => setIsPasswordRevealed(prev => !prev)}
                  />
                )}

                {isSignedIn && activeHomePanel === 'theme' && (
                  <HomeThemePanel
                    homeCopy={homeCopy}
                    language={language}
                    systemTheme={systemTheme}
                    themeColorControls={themeColorControls}
                    activeThemeColorKey={activeThemeColorKey}
                    showThemeCustomPicker={showThemeCustomPicker}
                    onPresetSelect={theme => {
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
                  />
                )}

                {isSignedIn && activeHomePanel === 'gallery' && (
                  <HomeGalleryPanel
                    homeCopy={homeCopy}
                    uploadedImages={uploadedImages}
                    onPreviewImage={setGalleryPreviewImage}
                  />
                )}

                {isSignedIn && isHomeSettingsPanel(activeHomePanel) && (
                  <HomeSettingsPanels
                    activeHomePanel={activeHomePanel}
                    homeCopy={homeCopy}
                    language={language}
                    permissionRequestState={permissionRequestState}
                    permissionStatusText={permissionStatusText}
                    settingsMenuItems={settingsMenuItems}
                    manualIconGuide={manualIconGuide}
                    apiSecurityCards={apiSecurityCards}
                    cloudMemoryApiEndpoint={cloudMemoryApiEndpoint}
                    cloudMcpEndpoint={cloudMcpEndpoint}
                    mcpHeaderValue={mcpHeaderValue}
                    mcpPlainToken={mcpPlainToken}
                    mcpTokenStatus={mcpTokenStatus}
                    mcpTokens={mcpTokens}
                    isMcpTokenBusy={isMcpTokenBusy}
                    isExportingData={isExportingData}
                    exportDataStatus={exportDataStatus}
                    onOpenPanel={panel => setActiveHomePanel(panel)}
                    onLanguageChange={nextLanguage => setLanguage(nextLanguage)}
                    onOpenPermissions={handleOpenPermissions}
                    onSignOut={handleSignOut}
                    onExportUserData={handleExportUserData}
                    onCopyMcpText={handleCopyMcpText}
                    onCreateMcpToken={handleCreateMcpToken}
                    onRevokeMcpToken={handleRevokeMcpToken}
                  />
                )}
              </AnimatePresence>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isInitialPermissionPromptOpen && isSignedIn && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2300] flex items-end justify-center bg-black/25 px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-6 pointer-events-auto"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 14, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[360px] rounded-[18px] bg-[var(--app-card)] p-4 text-black shadow-xl"
            >
              <div className="mb-2 flex items-center gap-2 text-[17px] font-medium leading-tight">
                <MapPin size={22} strokeWidth={UI_ICON_STROKE} />
                {homeCopy.initialPermissionsTitle}
              </div>
              <div className="text-[13px] font-medium leading-snug text-black/55">
                {homeCopy.initialPermissionsBody}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={closeInitialPermissionPrompt}
                  className="h-11 rounded-full bg-[var(--app-soft-card)] text-[14px] font-medium text-black transition-transform active:scale-[0.98]"
                >
                  {homeCopy.notNow}
                </button>
                <button
                  type="button"
                  onClick={handleInitialPermissionRequest}
                  disabled={permissionRequestState === 'requesting'}
                  className="h-11 rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
                >
                  {permissionRequestState === 'requesting' ? homeCopy.permissionRequesting : homeCopy.openPermissions}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isPasswordChangeOpen && isSignedIn && isCloudBackendEnabled && activeHomePanel === 'profile' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2300] flex items-center justify-center bg-black/35 px-5 py-[calc(env(safe-area-inset-top)+1rem)] pointer-events-auto"
          >
            <motion.form
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              onSubmit={event => {
                event.preventDefault();
                void handleChangePassword();
              }}
              className="w-full max-w-[360px] rounded-[18px] bg-[var(--app-card)] p-4 text-black shadow-xl"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-[18px] font-medium leading-tight">
                  <Lock size={23} strokeWidth={UI_ICON_STROKE} />
                  <span className="truncate">{homeCopy.changePassword}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsPasswordChangeOpen(false);
                    setCurrentPasswordInput('');
                    setNewPasswordInput('');
                    setConfirmPasswordInput('');
                    setPasswordChangeStatus('');
                  }}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-soft-card)] text-black transition-transform active:scale-95"
                  aria-label={homeCopy.closeManual}
                >
                  <X size={20} strokeWidth={UI_ICON_STROKE} />
                </button>
              </div>
              <div className="mb-3 text-[12px] font-medium leading-snug text-black/45">
                {homeCopy.passwordNotViewable}
              </div>
              <div className="space-y-2">
                <input
                  value={currentPasswordInput}
                  onChange={event => {
                    setCurrentPasswordInput(event.target.value);
                    setPasswordChangeStatus('');
                  }}
                  type="password"
                  autoComplete="current-password"
                  className="h-11 w-full rounded-[12px] bg-[var(--app-soft-card)] px-3 text-[15px] font-medium outline-none placeholder:text-black/30"
                  placeholder={homeCopy.currentPassword}
                  aria-label={homeCopy.currentPassword}
                />
                <input
                  value={newPasswordInput}
                  onChange={event => {
                    setNewPasswordInput(event.target.value);
                    setPasswordChangeStatus('');
                  }}
                  type="password"
                  autoComplete="new-password"
                  className="h-11 w-full rounded-[12px] bg-[var(--app-soft-card)] px-3 text-[15px] font-medium outline-none placeholder:text-black/30"
                  placeholder={homeCopy.newPassword}
                  aria-label={homeCopy.newPassword}
                />
                <input
                  value={confirmPasswordInput}
                  onChange={event => {
                    setConfirmPasswordInput(event.target.value);
                    setPasswordChangeStatus('');
                  }}
                  type="password"
                  autoComplete="new-password"
                  className="h-11 w-full rounded-[12px] bg-[var(--app-soft-card)] px-3 text-[15px] font-medium outline-none placeholder:text-black/30"
                  placeholder={homeCopy.confirmPassword}
                  aria-label={homeCopy.confirmPassword}
                />
              </div>
              {passwordChangeStatus && (
                <div className="mt-3 text-[12px] font-medium leading-snug text-black/45">
                  {passwordChangeStatus}
                </div>
              )}
              <button
                type="submit"
                disabled={isChangingPassword}
                className="mt-4 h-11 w-full rounded-full bg-[var(--app-dark)] text-[14px] font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {isChangingPassword ? homeCopy.changingPassword : homeCopy.savePassword}
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSignedIn && activeView === 'reader' && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className="absolute inset-0 z-[950] flex flex-col overflow-hidden bg-[var(--app-page)] font-sans pointer-events-auto"
          >
            <input
              ref={readerCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleReaderImageInput}
            />
            <input
              ref={readerImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReaderImageInput}
            />
            <div className={`flex-1 overflow-y-auto px-8 pb-32 ${screenTopPaddingClass}`}>
              <div className="mx-auto w-full max-w-[430px]">
                <div className="mb-12 flex items-start justify-between">
                  <button
                    onClick={() => {
                      saveReaderDraft();
                      setActiveView('records');
                      setReadingNoteTarget(null);
                      setIsReaderToolsOpen(false);
                      setReaderActivePanel(null);
                    }}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--app-icon)] text-black shadow-sm transition-transform active:scale-95"
                    aria-label={homeCopy.backToRecords}
                  >
                    <ChevronsLeft size={30} strokeWidth={UI_ICON_STROKE} />
                  </button>

                  {readerRecord && (
                    <div className="flex items-baseline gap-4 pt-3 text-black">
                      <span className="text-[34px] font-extrabold leading-none">
                        {new Date(readerRecord.timestamp).getDate()}
                      </span>
                      <span className="text-[22px] font-semibold leading-none text-black/35">
                        {formatRecordMonth(readerRecord.timestamp)}
                      </span>
                    </div>
                  )}
                </div>

                {readerRecord ? (
                  <article className="pr-4">
                    <h1
                      ref={readerTitleRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="note-reader-title mb-7 text-[36px] font-medium leading-tight"
                      style={{ color: readerRecord.note.color || '#D2936D' }}
                      onBeforeInput={event => handleReaderBeforeInput('title', event)}
                      onInput={handleReaderInput}
                      onPaste={event => handleReaderPaste('title', event)}
                      onFocus={saveReaderSelection}
                      onKeyUp={saveReaderSelection}
                      onMouseUp={saveReaderSelection}
                      onPointerUp={saveReaderSelection}
                      onSelect={saveReaderSelection}
                    />
                    <div
                      ref={readerContentRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="note-reader-content pb-10 text-[#7E9FBA]"
                      style={{ fontSize: `${readerRecord.note.fontSize || 20}px` }}
                      onBeforeInput={event => handleReaderBeforeInput('content', event)}
                      onInput={handleReaderInput}
                      onPaste={event => handleReaderPaste('content', event)}
                      onFocus={saveReaderSelection}
                      onKeyUp={saveReaderSelection}
                      onMouseUp={saveReaderSelection}
                      onPointerUp={saveReaderSelection}
                      onSelect={saveReaderSelection}
                      onClick={handleReaderContentClick}
                    />
                  </article>
                ) : (
                  <div className="pt-20 text-center text-[16px] font-medium text-black/40">
                    {homeCopy.readerMissing}
                  </div>
                )}
              </div>
            </div>

            {readerRecord && (
              <div className="absolute bottom-20 right-5 z-[1020] flex flex-col items-center gap-3">
                <AnimatePresence>
                  {isReaderToolsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 12, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12, scale: 0.96 }}
                      className="flex flex-col items-center gap-3"
                    >
                      <button className={readerToolButtonClass} onClick={() => {
                        saveReaderDraft();
                        setReaderActivePanel(null);
                      }} aria-label={homeCopy.readerEdit}>
                        <Save size={24} strokeWidth={UI_ICON_STROKE} />
                      </button>
                      <div className="relative">
                        <button
                          className={readerToolButtonClass}
                          onPointerDown={event => {
                            keepReaderSelectionPointerDown(event);
                            handleReaderPanelToggle('font');
                          }}
                          aria-label={homeCopy.readerReadingSize}
                        >
                          <span className="text-[28px] font-semibold leading-none">A</span>
                        </button>
                        {readerActivePanel === 'font' && (
                          <div className="absolute right-[calc(100%+10px)] top-1/2 z-[1030] flex w-[72px] -translate-y-1/2 flex-col gap-1 rounded-[14px] bg-[var(--app-dark)] p-1.5 shadow-xl">
                            {READER_FONT_SIZES.map(size => (
                              <button
                                key={size}
                                onPointerDown={event => {
                                  keepReaderSelectionPointerDown(event);
                                  handleReaderFontSize(size);
                                }}
                                className={`h-7 rounded-full text-[12px] font-medium transition-colors ${readerSelectedFontSize === size ? 'bg-white text-black' : 'text-white hover:bg-white/15'}`}
                              >
                                {size}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        className={`${readerToolButtonClass} ${readerSelectedUnderline ? 'bg-[var(--app-dark)] text-white' : ''}`}
                        onPointerDown={event => {
                          keepReaderSelectionPointerDown(event);
                          handleReaderUnderline();
                        }}
                        aria-label={homeCopy.readerUnderline}
                      >
                        <Underline size={24} strokeWidth={UI_ICON_STROKE} />
                      </button>
                      <button className={readerToolButtonClass} onClick={() => readerCameraInputRef.current?.click()} aria-label={homeCopy.readerAddPhoto}>
                        <Camera size={24} strokeWidth={UI_ICON_STROKE} />
                      </button>
                      <button className={readerToolButtonClass} onClick={() => readerImageInputRef.current?.click()} aria-label={homeCopy.readerJumpImage}>
                        <ImageIcon size={24} strokeWidth={UI_ICON_STROKE} />
                      </button>
                      <div className="relative">
                        <button
                          className={readerToolButtonClass}
                          onPointerDown={event => {
                            keepReaderSelectionPointerDown(event);
                            handleReaderPanelToggle('color');
                          }}
                          aria-label={homeCopy.readerEditColor}
                        >
                          <Palette size={24} strokeWidth={UI_ICON_STROKE} />
                        </button>
                        {readerActivePanel === 'color' && (
                          <div className="absolute right-[calc(100%+10px)] top-1/2 z-[1030] flex -translate-y-1/2 flex-col items-center">
                            <div className="relative box-border w-[124px] rounded-[20px] bg-[var(--app-dark)] p-2.5 shadow-lg">
                              <div className="grid grid-cols-4 gap-2">
                                {READER_TEXT_COLORS.map(color => (
                                  <button
                                    key={color}
                                    onPointerDown={event => {
                                      keepReaderSelectionPointerDown(event);
                                      handleReaderTextColor(color);
                                    }}
                                    className="h-[20px] w-[20px] rounded-full"
                                    style={{
                                      backgroundColor: color,
                                      boxShadow: readerSelectedColor === color ? '0 0 0 1.5px white' : 'none',
                                    }}
                                  />
                                ))}
                                <button
                                  onPointerDown={event => {
                                    keepReaderSelectionPointerDown(event);
                                    setReaderShowCustomPicker(!readerShowCustomPicker);
                                  }}
                                  className="relative h-[20px] w-[20px] overflow-hidden rounded-[6px]"
                                  style={{ boxShadow: readerShowCustomPicker || !READER_TEXT_COLORS.includes(readerSelectedColor) ? '0 0 0 1.5px white' : 'none' }}
                                >
                                  <div className="absolute inset-0 h-full w-full bg-gradient-to-br from-[#12c2e9] via-[#c471ed] to-[#f64f59] pointer-events-none" />
                                </button>
                              </div>
                            </div>

                            {readerShowCustomPicker && (
                              <div className="picker-popup absolute left-1/2 top-full z-50 mt-2 flex w-[124px] -translate-x-1/2 flex-col gap-2 rounded-[16px] bg-[var(--app-dark)] p-2.5 shadow-xl">
                                <HexColorPicker color={readerSelectedColor} onChange={handleReaderTextColor} />
                                <div className="flex w-full items-center">
                                  <span className="mr-1 pt-[1px] font-mono text-[13px] leading-none text-white/70">#</span>
                                  <HexColorInput
                                    color={readerSelectedColor}
                                    onChange={handleReaderTextColor}
                                    className="h-[22px] min-w-0 flex-1 rounded-[6px] border border-white/20 bg-white/10 px-1.5 font-mono text-[12px] uppercase text-white focus:border-white/50 focus:outline-none"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <button className={readerToolButtonClass} onClick={() => {
                        setReaderActivePanel(null);
                        setIsReaderToolsOpen(false);
                      }} aria-label={homeCopy.readerCollapseTools}>
                        <ChevronUp size={30} strokeWidth={UI_ICON_STROKE} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!isReaderToolsOpen && (
                  <button className={readerToolButtonClass} onClick={() => setIsReaderToolsOpen(true)} aria-label={homeCopy.readerExpandTools}>
                    <Menu size={24} strokeWidth={UI_ICON_STROKE} />
                  </button>
                )}

                <button className={readerToolButtonClass} onClick={locateReaderRecord} aria-label={homeCopy.readerLocate}>
                  <MapPin size={26} strokeWidth={UI_ICON_STROKE} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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

      <AnimatePresence>
        {isSearchOpen && activeView !== 'home' && activeView !== 'stats' && activeView !== 'reader' && !isTracking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1800] flex items-start justify-center bg-black/[0.28] px-6 pb-6 pt-[calc(env(safe-area-inset-top)+4.75rem)] pointer-events-auto"
            onPointerDown={closeSearchModal}
          >
            <motion.form
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-[360px]"
              onPointerDown={event => event.stopPropagation()}
              onSubmit={event => {
                event.preventDefault();
                if (activeSearchField === 'coordinate') {
                  handleCoordinateSearch();
                } else {
                  handleTextSearch();
                }
              }}
            >
              <div className="relative flex flex-col gap-2">
                <input
                  value={coordinateSearch}
                  onFocus={() => setActiveSearchField('coordinate')}
                  onPointerDown={() => setActiveSearchField('coordinate')}
                  onChange={event => setCoordinateSearch(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') handleCoordinateSearch();
                  }}
                  placeholder="(35.8626, 129.1945)"
                  className={`${searchInputClass('coordinate')} pr-14`}
                />
                <label className={`flex h-12 items-center rounded-full px-5 text-black transition-colors ${
                  activeSearchField === 'text' ? 'bg-[var(--app-active-surface)] shadow-sm' : 'bg-[var(--app-card)]'
                }`}>
                  <input
                    value={textSearch}
                    onFocus={() => setActiveSearchField('text')}
                    onPointerDown={() => setActiveSearchField('text')}
                    onChange={event => {
                      setTextSearch(event.target.value);
                      setSubmittedTextSearch('');
                    }}
                    placeholder={homeCopy.searchPlaceholder}
                    className="min-w-0 flex-1 bg-transparent pr-10 text-[15px] font-medium outline-none placeholder:text-black/25"
                  />
                </label>
                <button
                  type="submit"
                  className="absolute right-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black transition-colors hover:bg-black/5"
                  style={{ top: activeSearchField === 'coordinate' ? 6 : 62 }}
                  aria-label={homeCopy.runSearch}
                >
                  <Search size={28} strokeWidth={UI_ICON_STROKE} />
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation Bar */}
      {isSignedIn && activeView !== 'reader' && activeView !== 'searchResults' && (
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]">
        <div className="bg-[var(--app-nav-surface)] backdrop-blur-lg rounded-[2rem] px-2.5 py-2 flex items-center gap-2.5 shadow-sm border border-[var(--app-icon)] transition-all duration-300 ease-out">
          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('map');
              setActiveHomePanel(null);
              setIsRecordsMenuOpen(false);
            }}
            className={getBottomNavClass('map')}
            aria-label={homeCopy.bottomMap}
          >
            <MapIcon size={24} strokeWidth={UI_ICON_STROKE} />
          </motion.button>

          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('stats');
              setActiveHomePanel(null);
              setIsMenuOpen(false);
              setIsMapStyleMenuOpen(false);
              setTagMenuOpen(false);
              setIsRecordsMenuOpen(false);
              setIsRecordsCalendarOpen(false);
            }}
            className={getBottomNavClass('stats')}
            aria-label={homeCopy.bottomStats}
          >
            <PieChart size={24} strokeWidth={UI_ICON_STROKE} />
          </motion.button>
          
          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('records');
              setActiveHomePanel(null);
              setIsMenuOpen(false);
              setIsMapStyleMenuOpen(false);
              setTagMenuOpen(false);
            }}
            className={getBottomNavClass('records')}
            aria-label={homeCopy.bottomNotes}
          >
            <BookOpen size={24} strokeWidth={UI_ICON_STROKE} />
          </motion.button>
          
          <motion.button
            layout
            transition={bottomNavTransition}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setActiveView('home');
              setIsMenuOpen(false);
              setIsMapStyleMenuOpen(false);
              setTagMenuOpen(false);
              setIsRecordsMenuOpen(false);
            }}
            className={getBottomNavClass('home')}
            aria-label={homeCopy.bottomHome}
          >
            <Home size={24} strokeWidth={UI_ICON_STROKE} />
          </motion.button>
        </div>
      </div>
      )}

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

      {galleryPreviewImage && (
        <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/80 p-4">
          <button
            onClick={() => setGalleryPreviewImage(null)}
            className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label={homeCopy.closeImagePreview}
          >
            <X size={22} strokeWidth={UI_ICON_STROKE} />
          </button>
          <button
            onClick={() => { void downloadGalleryImage(galleryPreviewImage); }}
            className="absolute right-[4.25rem] top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label={homeCopy.downloadImage}
          >
            <Download size={21} strokeWidth={UI_ICON_STROKE} />
          </button>
          <img
            src={galleryPreviewImage.src}
            alt={galleryPreviewImage.title}
            className="max-h-full max-w-full rounded-[18px] object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
