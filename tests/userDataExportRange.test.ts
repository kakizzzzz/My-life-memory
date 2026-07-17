import assert from 'node:assert/strict';
import test from 'node:test';
import { filterStarsForUserDataExport } from '../src/lib/userDataExport';
import type { NoteData, StarData } from '../src/types/app';

const localTimestamp = (
  year: number,
  month: number,
  day: number,
  hour = 12,
) => new Date(year, month - 1, day, hour).getTime();

const note = (id: string, createdAt: number): NoteData => ({
  id,
  title: id,
  content: id,
  createdAt,
});

const stars: StarData[] = [
  {
    id: 'star-with-notes',
    lat: 31.2,
    lng: 121.5,
    notes: [
      note('july-1', localTimestamp(2026, 7, 1)),
      note('july-10', localTimestamp(2026, 7, 10)),
      note('july-31-late', localTimestamp(2026, 7, 31, 23)),
      note('august-1', localTimestamp(2026, 8, 1)),
    ],
  },
  {
    id: 'star-outside-range',
    lat: 35.6,
    lng: 139.7,
    notes: [note('june-30', localTimestamp(2026, 6, 30))],
  },
];

test('date-range export includes both boundary dates and excludes unrelated stars', () => {
  const filtered = filterStarsForUserDataExport(stars, {
    startDate: '2026-07-10',
    endDate: '2026-07-31',
  });

  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0].notes?.map(item => item.id), [
    'july-10',
    'july-31-late',
  ]);
  assert.equal(stars[0].notes?.length, 4, 'filtering must not mutate app state');
});

test('a same-day export includes every note created during that local day', () => {
  const filtered = filterStarsForUserDataExport(stars, {
    startDate: '2026-07-31',
    endDate: '2026-07-31',
  });

  assert.deepEqual(filtered[0].notes?.map(item => item.id), ['july-31-late']);
});

test('an invalid or reversed date range is rejected', () => {
  assert.throws(
    () => filterStarsForUserDataExport(stars, {
      startDate: '2026-08-01',
      endDate: '2026-07-01',
    }),
    /Invalid export date range/,
  );
  assert.throws(
    () => filterStarsForUserDataExport(stars, { startDate: '2026-02-30' }),
    /Invalid export start date/,
  );
});
