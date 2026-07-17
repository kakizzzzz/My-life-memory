import React from 'react';
import { sanitizeRichHtml } from '../lib/htmlSanitizer';
import {
  buildStorageImageSrc,
  hydrateStorageMediaHtml,
} from '../lib/mediaStorage';
import {
  extractImagesFromHtml,
  htmlToText,
} from '../lib/noteHtmlUtils';
import { countSearchMatches } from '../lib/searchUtils';
import { getPointsEveryXMeters } from '../lib/trackUtils';
import {
  buildCalendarActivityDateKeys,
  buildNoteRecords,
  buildRecordDateSummaries,
  buildStarRecordRankings,
} from '../lib/memoryRecords';
import { getNoteTimestamp } from '../lib/noteDataUtils';
import type { MapActivityPoint, TextRankingItem } from '../TripStatisticsView';
import type {
  RecordsByDateGroup,
  RecordsFilter,
  StarData,
  TrackData,
  UploadedImage,
} from '../types/app';
import type { SearchResultRecord } from '../SearchResultsScreen';

type MemoryDerivedCopy = {
  noteLabel: string;
  starLabel: string;
  untitledNote: string;
};

type UseMemoryDerivedDataParams = {
  stars: StarData[];
  savedTracks: TrackData[];
  isTracking: boolean;
  trackPaths: [number, number][][];
  recordsFilter: RecordsFilter;
  selectedRecordsDateKey: string | null;
  submittedTextSearch: string;
  recordsCalendarDate: Date;
  mediaRefreshKey: number;
  copy: MemoryDerivedCopy;
};

export const useMemoryDerivedData = ({
  stars,
  savedTracks,
  isTracking,
  trackPaths,
  recordsFilter,
  selectedRecordsDateKey,
  submittedTextSearch,
  recordsCalendarDate,
  mediaRefreshKey,
  copy,
}: UseMemoryDerivedDataParams) => {
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
            title: note.title || `${copy.noteLabel} ${noteIndex + 1} / ${copy.starLabel} ${starIndex + 1}`,
          });
        });
      });
    });
    return images;
  }, [copy.noteLabel, copy.starLabel, mediaRefreshKey, stars]);

  const noteRecords = React.useMemo(() => {
    return buildNoteRecords({
      stars,
      recordsFilter,
      selectedRecordsDateKey,
      copy,
    });
  }, [copy.noteLabel, copy.untitledNote, recordsFilter, selectedRecordsDateKey, stars]);

  const searchResultRecords = React.useMemo<SearchResultRecord[]>(() => {
    const query = submittedTextSearch.trim().toLowerCase();
    if (!query) return [];

    return stars
      .flatMap((star, starIndex) => (
        (star.notes || []).map((note, noteIndex) => {
          const timestamp = getNoteTimestamp(note);
          const title = htmlToText(note.titleHtml) || note.title || `${copy.noteLabel} ${noteIndex + 1}`;
          const text = htmlToText(note.contentHtml) || note.content || title || copy.untitledNote;
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
            isMatch: matchCount > 0,
          };
        })
      ))
      .filter(record => record.isMatch)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [copy.noteLabel, copy.untitledNote, stars, submittedTextSearch]);

  const recordsByDate = React.useMemo<RecordsByDateGroup[]>(() => {
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

  const recordDateSummaries = React.useMemo(() => buildRecordDateSummaries(stars), [stars]);

  const recordDateKeys = React.useMemo(() => (
    new Set(recordDateSummaries.map(date => date.dateKey))
  ), [recordDateSummaries]);

  const calendarActivityDateKeys = React.useMemo(
    () => buildCalendarActivityDateKeys(stars, recordDateSummaries),
    [recordDateSummaries, stars],
  );

  const mapActivity = React.useMemo(() => {
    const points: MapActivityPoint[] = [];

    const addPoint = (lat: number, lng: number, weight: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || weight <= 0) return;
      points.push({ lat, lng, weight });
    };

    stars.forEach(star => {
      addPoint(star.lat, star.lng, 1);
      const savedNoteCount = (star.notes || []).length;
      if (savedNoteCount > 0) addPoint(star.lat, star.lng, savedNoteCount);
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

  const starRecordRankings = React.useMemo<TextRankingItem[]>(
    () => buildStarRecordRankings(stars),
    [stars],
  );

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

  return {
    uploadedImages,
    recordsByDate,
    searchResultRecords,
    recordDateKeys,
    calendarActivityDateKeys,
    mapActivity,
    markedLocationCount,
    starRecordRankings,
    recordsCalendarDays,
    recordsCalendarEmptyDays,
    recordsCalendarMonths,
  };
};
