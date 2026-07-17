import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MCP_MEMORY_INSTRUCTIONS,
  researchMemoryContext,
  resolveExactMemoryCountryRegion,
  resolveMemoryCountryRegion,
  type ResolvedMemoryPlace,
} from '../supabase/functions/_shared/memory-research.ts';
import { resolveMemoryPlace } from '../supabase/functions/_shared/memory-place-resolver.ts';
import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
  TrackRow,
} from '../supabase/functions/_shared/memory-record-types.ts';

const at = (value: string) => Date.parse(`${value}T12:00:00Z`);

const star = (id: string, lat: number, lng: number, createdAt: number): StarRow => ({
  id,
  sort_order: 0,
  lat,
  lng,
  created_at_ms: createdAt,
  tag_order: null,
  tag_group_id: null,
  color: '#cccccc',
});

const note = (id: string, starId: string, createdAt: number, content: string): NoteRow => ({
  star_id: starId,
  id,
  sort_order: 0,
  title: '',
  title_html: '',
  content,
  content_html: `<p>${content}</p>`,
  image_url: null,
  image_urls: [],
  images: [],
  font_size: null,
  title_font_size: null,
  color: null,
  created_at_ms: createdAt,
  updated_at_ms: createdAt,
});

const track = (id: string, createdAt: number, points: [number, number][]): TrackRow => ({
  id,
  sort_order: 0,
  paths: [points],
  color: '#cccccc',
  duration_seconds: 120,
  distance_km: 1.2,
  created_at_ms: createdAt,
  updated_at_ms: createdAt,
});

const memory = (
  stars: StarRow[],
  notes: NoteRow[],
  tracks: TrackRow[] = [],
): NormalizedMemoryRows => ({
  userId: 'user-1',
  account: 'kaki',
  profile: null,
  revision: 1,
  stars,
  notes,
  tracks,
});

test('country aliases retrieve geographically even when notes omit the country keyword', () => {
  const tokyo = star('tokyo', 35.6762, 139.6503, at('2026-01-03'));
  const osaka = star('osaka', 34.6937, 135.5023, at('2026-01-05'));
  const shanghai = star('shanghai', 31.2304, 121.4737, at('2026-03-10'));
  const result = researchMemoryContext(memory(
    [tokyo, osaka, shanghai],
    [
      note('n-tokyo', tokyo.id, at('2026-01-03'), 'Morning walk beside a quiet station.'),
      note('n-osaka', osaka.id, at('2026-01-05'), 'A small dinner after visiting the museum.'),
      note('n-shanghai', shanghai.id, at('2026-03-10'), 'Back to an ordinary weekday.'),
    ],
    [track('route-jp', at('2026-01-04'), [[35.67, 139.65], [35.68, 139.7]])],
  ), { query: '日本旅行' });

  assert.equal(result.searchPlan.mode, 'country');
  assert.equal(result.searchPlan.resolvedRegion?.code, 'JP');
  assert.deepEqual(new Set(result.selectedNoteIds), new Set(['n-tokyo', 'n-osaka']));
  assert.deepEqual(result.selectedTrackIds, ['route-jp']);
  assert.equal(result.latestRecordedMemory?.starId, 'shanghai');
  assert.equal(result.latestRecordedMemory?.relationToSearchArea, 'outside');
  assert.match(result.latestRecordedMemory?.caution || '', /not verified current location/i);
  assert.equal(result.classification.label, 'travel');
  assert.ok(result.classification.confidence >= 0.8);
});

test('resolved cities and towns use the same spatial and temporal research flow', () => {
  const ningbo = star('ningbo', 29.8683, 121.544, at('2026-07-01'));
  const shanghai = star('shanghai', 31.2304, 121.4737, at('2026-07-10'));
  const resolvedPlace: ResolvedMemoryPlace = {
    name: 'Example City',
    displayName: 'Example City, Zhejiang, China',
    type: 'city',
    countryCode: 'CN',
    center: { lat: 29.8683, lng: 121.544 },
    boxes: [[29.5, 121.1, 30.2, 122.0]],
    provider: 'Nominatim',
    attribution: 'Geocoding data © OpenStreetMap contributors, ODbL 1.0.',
  };
  const result = researchMemoryContext(memory(
    [ningbo, shanghai],
    [
      note('n-ningbo', ningbo.id, at('2026-07-01'), 'Walked along the river.'),
      note('n-shanghai', shanghai.id, at('2026-07-10'), 'Returned home.'),
    ],
  ), {
    query: '示例城市那次旅行',
    place: '示例城市',
    resolvedPlace,
    placeResolution: { status: 'resolved', query: '示例城市' },
  });

  assert.equal(result.searchPlan.mode, 'place');
  assert.equal(result.searchPlan.resolvedRegion?.name, 'Example City');
  assert.deepEqual(result.selectedNoteIds, ['n-ningbo']);
  assert.deepEqual(result.selectedStarIds, ['ningbo']);
  assert.equal(result.latestRecordedMemory?.relationToSearchArea, 'outside');
});

test('repeated records over time lean daily instead of forcing a trip label', () => {
  const location = star('tokyo-home', 35.68, 139.76, at('2026-01-01'));
  const records = ['2026-01-01', '2026-03-10', '2026-06-20'].map((date, index) => (
    note(`n-${index}`, location.id, at(date), `Ordinary record ${index}`)
  ));
  const result = researchMemoryContext(memory([location], records), { query: '日本生活' });
  assert.equal(result.classification.label, 'daily');
  assert.ok(result.clusters.length >= 3);
});

test('Okinawa is included in the offline Japan region coverage', () => {
  const okinawa = star('okinawa', 26.2124, 127.6809, at('2026-05-01'));
  const result = researchMemoryContext(memory(
    [okinawa],
    [note('n-okinawa', okinawa.id, at('2026-05-01'), 'Blue water and a long walk.')],
  ), { query: '日本' });
  assert.deepEqual(result.selectedNoteIds, ['n-okinawa']);
});

test('place resolver sends only the explicit place name and caches repeated lookups', async () => {
  let calls = 0;
  let requestedUrl = '';
  const fetchImpl: typeof fetch = async input => {
    calls += 1;
    requestedUrl = String(input);
    return new Response(JSON.stringify([
      {
        name: 'Example Town',
        display_name: 'Example Town, Kanagawa, Japan',
        lat: '35.3392',
        lon: '139.4900',
        boundingbox: ['35.20', '35.46', '139.38', '139.58'],
        addresstype: 'city',
        importance: 0.55,
        address: { country_code: 'jp' },
      },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const input = {
    place: 'Example Town',
    countryCode: 'JP',
    memoryCoordinates: [{ lat: 35.34, lng: 139.49 }],
    endpoint: 'https://resolver.example/search',
    fetchImpl,
  };
  const first = await resolveMemoryPlace(input);
  const second = await resolveMemoryPlace(input);

  assert.equal(calls, 1);
  assert.equal(new URL(requestedUrl).searchParams.get('q'), 'Example Town');
  assert.equal(new URL(requestedUrl).searchParams.get('countrycodes'), 'jp');
  assert.equal(first.summary.status, 'resolved');
  assert.equal(first.resolvedPlace?.name, 'Example Town');
  assert.deepEqual(second.resolvedPlace, first.resolvedPlace);
});

test('country matching distinguishes exact country names from city plus country', () => {
  assert.equal(resolveExactMemoryCountryRegion('日本')?.region.code, 'JP');
  assert.equal(resolveExactMemoryCountryRegion('Example Town, Japan'), null);
  assert.equal(resolveMemoryCountryRegion('Example Town, Japan')?.region.code, 'JP');
});

test('MCP instructions require geographic research and prohibit invented memories', () => {
  assert.match(MCP_MEMORY_INSTRUCTIONS, /country, city, town, village/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /place argument/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /not proof of the user's current location/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /do not infer or invent/i);
});
