import type { NormalizedMemoryRows } from './memory-record-types.ts';
import {
  dateKeyFor,
  noteHasStoredImages,
  noteText,
  noteTitle,
  routeSummary,
  stripHtml,
} from './memory-presenters.ts';

type UnknownRecord = Record<string, unknown>;

type MemoryResearchDisclosure = {
  authorizedRecordNoteIds?: unknown;
  authorizedLocationStarIds?: unknown;
  authorizedRouteTrackIds?: unknown;
  evidencePassages?: unknown;
  queryPlan?: unknown;
};

const asRecord = (value: unknown): UnknownRecord => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
);

const orderedIds = (value: unknown, limit: number) => (
  Array.isArray(value)
    ? [...new Set(value.filter(id => typeof id === 'string' && id).map(String))].slice(0, limit)
    : []
);

const excerptText = (value: unknown) => stripHtml(String(value || ''))
  .replace(/\s+/g, ' ')
  .trim();

export const buildMemoryResearchEvidencePayload = ({
  memory,
  research,
  timeZone,
}: {
  memory: NormalizedMemoryRows;
  research: MemoryResearchDisclosure;
  timeZone: string;
}) => {
  const starById = new Map(memory.stars.map(star => [star.id, star]));
  const noteById = new Map(memory.notes.map(note => [note.id, note]));
  const trackById = new Map(memory.tracks.map(track => [track.id, track]));
  const starIndex = new Map(memory.stars.map((star, index) => [star.id, index]));
  const noteCountByStarId = memory.notes.reduce((counts, note) => {
    counts.set(note.star_id, (counts.get(note.star_id) || 0) + 1);
    return counts;
  }, new Map<string, number>());
  const passages = Array.isArray(research.evidencePassages)
    ? research.evidencePassages.map(asRecord)
    : [];

  const records = orderedIds(research.authorizedRecordNoteIds, 100).flatMap(noteId => {
    const note = noteById.get(noteId);
    const star = note ? starById.get(note.star_id) : null;
    if (!note || !star) return [];
    const passageExcerpt = passages
      .filter(passage => String(passage.noteId || '') === note.id)
      .map(passage => excerptText(passage.text))
      .filter(Boolean)
      .join(' ');
    const createdAt = note.created_at_ms ?? star.created_at_ms;
    return [{
      id: note.id,
      starId: star.id,
      title: noteTitle(note),
      excerpt: excerptText(passageExcerpt || noteText(note)).slice(0, 240),
      createdAt,
      localDate: dateKeyFor(createdAt, timeZone),
      hasImages: noteHasStoredImages(note),
      coordinates: { lat: star.lat, lng: star.lng },
    }];
  });

  const locations = orderedIds(research.authorizedLocationStarIds, 100).flatMap(starId => {
    const star = starById.get(starId);
    if (!star) return [];
    return [{
      id: star.id,
      index: starIndex.get(star.id) || 0,
      coordinates: { lat: star.lat, lng: star.lng },
      noteCount: noteCountByStarId.get(star.id) || 0,
    }];
  });

  const queryPlan = asRecord(research.queryPlan);
  const routes = queryPlan.routeIntent === true
    ? orderedIds(research.authorizedRouteTrackIds, 20).flatMap(trackId => {
        const track = trackById.get(trackId);
        if (!track) return [];
        const summary = routeSummary(track, false);
        return [{
          id: summary.id,
          durationSeconds: summary.durationSeconds,
          distance: summary.distance,
          createdAt: summary.createdAt,
          segmentCount: summary.segmentCount,
          pointCount: summary.pointCount,
        }];
      })
    : [];

  return { records, locations, routes };
};
