import { formatRecordMonth, getCalendarDateKey } from './dateUtils';
import { getNoteTimestamp } from './noteDataUtils';
import { htmlToText } from './noteHtmlUtils';
import type { NoteRecord, RecordsFilter, StarData } from '../types/app';

type MemoryRecordCopy = {
  noteLabel: string;
  untitledNote: string;
};

type BuildNoteRecordsParams = {
  stars: StarData[];
  recordsFilter: RecordsFilter;
  selectedRecordsDateKey: string | null;
  copy: MemoryRecordCopy;
  now?: Date;
};

export type RecordDateSummary = {
  dateKey: string;
  day: number;
  month: string;
  timestamp: number;
  count: number;
};

export const buildNoteRecords = ({
  stars,
  recordsFilter,
  selectedRecordsDateKey,
  copy,
  now = new Date(),
}: BuildNoteRecordsParams): NoteRecord[] => {
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
        };
      })
    ))
    .filter(record => {
      if (selectedRecordsDateKey && record.dateKey !== selectedRecordsDateKey) return false;
      if (recordsFilter === 'monthly' && record.monthKey !== currentMonthKey) return false;
      if (recordsFilter === 'annual' && record.year !== currentYear) return false;
      return true;
    })
    .sort((a, b) => b.timestamp - a.timestamp);
};

export const buildRecordDateSummaries = (stars: StarData[]): RecordDateSummary[] => {
  const counts = new Map<string, RecordDateSummary>();
  stars.forEach(star => {
    (star.notes || []).forEach(note => {
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
};

export const buildCalendarActivityDateKeys = (
  stars: StarData[],
  recordDateSummaries: RecordDateSummary[],
) => {
  const keys = new Set(recordDateSummaries.map(date => date.dateKey));
  stars.forEach(star => {
    if (!star.createdAt) return;
    keys.add(getCalendarDateKey(new Date(star.createdAt)));
  });
  return keys;
};

export const buildStarRecordRankings = (stars: StarData[]) => (
  stars
    .map((star, index) => ({
      name: String(index + 1),
      value: (star.notes || []).length,
      fill: star.color || '#EDC727',
    }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((item, index) => ({ ...item, name: String(index + 1) }))
);
