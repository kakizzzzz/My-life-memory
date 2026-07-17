import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCalendarActivityDateKeys,
  buildNoteRecords,
  buildRecordDateSummaries,
  buildStarRecordRankings,
} from '../src/lib/memoryRecords';
import type { StarData } from '../src/types/app';

test('an intentionally saved blank note remains visible as a dated record', () => {
  const createdAt = Date.UTC(2026, 6, 17, 12, 30);
  const stars: StarData[] = [{
    id: 'star-blank-note',
    lat: 31.2304,
    lng: 121.4737,
    color: '#EDC727',
    notes: [{
      id: 'note-blank',
      title: '',
      titleHtml: '',
      content: '',
      contentHtml: '',
      createdAt,
      updatedAt: createdAt,
      fontSize: 18,
      titleFontSize: 18,
      color: '#D2936D',
    }],
  }];

  const records = buildNoteRecords({
    stars,
    recordsFilter: 'all',
    selectedRecordsDateKey: null,
    copy: {
      noteLabel: 'Note',
      untitledNote: 'Untitled note',
    },
    now: new Date(createdAt),
  });
  const dateSummaries = buildRecordDateSummaries(stars);
  const calendarActivityDateKeys = buildCalendarActivityDateKeys(stars, dateSummaries);
  const rankings = buildStarRecordRankings(stars);

  assert.equal(records.length, 1);
  assert.equal(records[0].text, 'Untitled note');
  assert.equal(dateSummaries[0]?.dateKey, '2026-07-17');
  assert.equal(calendarActivityDateKeys.has('2026-07-17'), true);
  assert.equal(rankings[0]?.value, 1);
});
