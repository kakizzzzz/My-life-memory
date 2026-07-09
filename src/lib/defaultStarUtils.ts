import {
  DEFAULT_RECORD_STAR_ID,
  DEFAULT_RECORD_STAR_LOCATION,
  LEGACY_RECORD_STAR_LOCATION,
  SAMPLE_NOTE_IMAGE_URL,
  SAMPLE_NOTE_TEXT,
} from '../constants/appDefaults';
import type { StarData } from '../types/app';

export const createDefaultRecordStar = (): StarData => {
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

export const getNearbyDefaultStarLocation = (point: [number, number]): [number, number] => {
  const northMeters = 80;
  const eastMeters = 80;
  const latDelta = northMeters / 111320;
  const lngDelta = eastMeters / (111320 * Math.max(0.01, Math.cos(point[0] * Math.PI / 180)));
  return [point[0] + latDelta, point[1] + lngDelta];
};

export const isNearCoordinate = (lat: number, lng: number, target: [number, number], tolerance = 0.002) => (
  Math.abs(lat - target[0]) <= tolerance && Math.abs(lng - target[1]) <= tolerance
);

export const normalizeInitialStars = (stars?: StarData[]) => {
  if (!Array.isArray(stars) || stars.length === 0) return null;

  return stars.map(star => (
    star.id === DEFAULT_RECORD_STAR_ID && isNearCoordinate(star.lat, star.lng, LEGACY_RECORD_STAR_LOCATION)
      ? { ...star, lat: DEFAULT_RECORD_STAR_LOCATION[0], lng: DEFAULT_RECORD_STAR_LOCATION[1] }
      : star
  ));
};
