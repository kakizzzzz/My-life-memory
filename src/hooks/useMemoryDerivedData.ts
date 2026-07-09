import React from 'react';
import { sanitizeRichHtml } from '../lib/htmlSanitizer';
import {
  buildStorageImageSrc,
  hydrateStorageMediaHtml,
} from '../lib/mediaStorage';
import {
  extractImagesFromHtml,
  hasMeaningfulNoteContent,
  htmlToText,
} from '../lib/noteHtmlUtils';
import { getNoteTimestamp } from '../lib/noteDataUtils';
import { countSearchMatches } from '../lib/searchUtils';
import { formatRecordMonth, getCalendarDateKey } from '../lib/dateUtils';
import { getPointsEveryXMeters } from '../lib/trackUtils';
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
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentYear = now.getFullYear();

    return stars
      .flatMap((star, starIndex) => (
        (star.notes || []).map((note, noteIndex) => {
          const timestamp = getNoteTimestamp(note);
          const date = new Date(timestamp);
          const text = htmlToText(note.contentHtml) || note.content || note.title || copy.untitledNote;
          const title = htmlToText(note.titleHtml) || note.title || `${copy.noteLabel} ${noteIndex + 1}`;
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
            hasContent: hasMeaningfulNoteContent(note),
            isMatch: matchCount > 0,
          };
        })
      ))
      .filter(record => record.hasContent && record.isMatch)
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
