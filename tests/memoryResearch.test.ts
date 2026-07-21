import assert from 'node:assert/strict';
import test from 'node:test';
import * as z from 'zod/v4';
import {
  MCP_MEMORY_INSTRUCTIONS,
  researchMemoryContext,
  resolveExactMemoryCountryRegion,
  resolveMemoryCountryRegion,
  type ResolvedMemoryPlace,
} from '../supabase/functions/_shared/memory-research.ts';
import { projectPublicMemoryResearchResponse } from '../supabase/functions/_shared/memory-public-response.ts';
import { buildMemoryResearchEvidencePayload } from '../supabase/functions/_shared/memory-research-evidence.ts';
import { MEMORY_RESEARCH_OUTPUT_SCHEMA } from '../supabase/functions/_shared/mcp-memory-public-schema.mjs';
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

const publicEnvelope = (query: string, response: Record<string, unknown>) => ({
  ok: true,
  source: 'my-life-memory-normalized-v2',
  action: 'research_memory_context',
  query,
  timestamp: '2026-07-18T00:00:00.000Z',
  temporalContext: {
    timeZone: 'Asia/Tokyo',
    currentUtcDateTime: '2026-07-18T00:00:00.000Z',
    currentLocalDate: '2026-07-18',
    currentLocalDateTime: '2026-07-18T09:00:00+09:00',
    currentDateRole: 'query-evaluation-only',
  },
  ...response,
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
  assert.deepEqual(new Set(result.authorizedRecordNoteIds), new Set(['n-tokyo', 'n-osaka']));
  assert.deepEqual(new Set(result.authorizedLocationStarIds), new Set(['tokyo', 'osaka']));
  assert.deepEqual(result.authorizedRouteTrackIds, []);
  assert.deepEqual(result.answerBoundary.verifiedPlaceNames, ['Japan']);
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

test('resolved public places expose selected records even without claim passages', () => {
  const tokyo = star('tokyo', 35.6762, 139.6503, at('2026-07-10'));
  const outside = star('outside', 31.2304, 121.4737, at('2026-07-12'));
  const tokyoMemory = {
    ...note('tokyo-note', tokyo.id, at('2026-07-10'), 'A joyful synthetic afternoon beside the river.'),
    image_url: 'storage://synthetic/tokyo.jpg',
  };
  const resolvedPlace: ResolvedMemoryPlace = {
    name: 'Tokyo',
    displayName: 'Tokyo, Japan',
    type: 'city',
    countryCode: 'JP',
    center: { lat: 35.6762, lng: 139.6503 },
    boxes: [[35.5, 139.4, 35.9, 139.9]],
    provider: 'test',
    attribution: 'test',
  };
  const archive = memory(
    [tokyo, outside],
    [
      tokyoMemory,
      note('outside-note', outside.id, at('2026-07-12'), 'A synthetic ordinary weekday.'),
    ],
  );
  const research = researchMemoryContext(archive, {
    query: 'What memories do I have in Tokyo?',
    place: 'Tokyo',
    resolvedPlace,
    placeResolution: { status: 'resolved', query: 'Tokyo' },
  });

  assert.equal(research.answerBoundary.status, 'supported');
  assert.deepEqual(research.selectedNoteIds, ['tokyo-note']);
  assert.deepEqual(research.authorizedRecordNoteIds, ['tokyo-note']);
  assert.deepEqual(research.authorizedLocationStarIds, ['tokyo']);
  assert.deepEqual(research.answerBoundary.verifiedPlaceNames, ['Tokyo, Japan']);
  assert.deepEqual(research.evidencePassages, []);
  assert.deepEqual(research.selectedImageNoteIds, ['tokyo-note']);

  const evidence = buildMemoryResearchEvidencePayload({
    memory: archive,
    research,
    timeZone: 'Asia/Tokyo',
  });
  const publicResponse = projectPublicMemoryResearchResponse({
    research,
    ...evidence,
  });

  assert.equal(evidence.records[0]?.excerpt, 'A joyful synthetic afternoon beside the river.');
  assert.equal(evidence.records[0]?.localDate, '2026-07-10');
  assert.equal(publicResponse.status, 'supported');
  assert.equal(publicResponse.evidence.passages.length, 0);
  assert.deepEqual(publicResponse.evidence.records.map(record => record.id), ['tokyo-note']);
  assert.deepEqual(publicResponse.evidence.locations.map(location => location.id), ['tokyo']);
  assert.deepEqual(publicResponse.evidence.selectedImageNoteIds, ['tokyo-note']);
  assert.equal(
    z.fromJSONSchema(MEMORY_RESEARCH_OUTPUT_SCHEMA)
      .safeParse(publicEnvelope(research.query, publicResponse)).success,
    true,
  );
});

test('country scope authorizes bounded records with local dates for one-call subjective comparison', () => {
  const tokyo = star('tokyo-happy', 35.6762, 139.6503, at('2026-07-10'));
  const kyoto = star('kyoto-happy', 35.0116, 135.7681, at('2026-07-11'));
  const shanghai = star('shanghai-control', 31.2304, 121.4737, at('2026-07-12'));
  const archive = memory(
    [tokyo, kyoto, shanghai],
    [
      note('tokyo-happy-note', tokyo.id, at('2026-07-10'), 'A calm synthetic morning with a warm smile.'),
      note('kyoto-happy-note', kyoto.id, at('2026-07-11'), 'The most joyful synthetic evening of the whole journey.'),
      note('shanghai-control-note', shanghai.id, at('2026-07-12'), 'A synthetic routine after returning.'),
    ],
  );
  const query = 'Look through my Japan trip memories and compare the recorded experiences to guess which local day I seemed happiest.';
  const research = researchMemoryContext(archive, { query, place: 'Japan', limit: 100 }, 'Asia/Tokyo');
  const evidence = buildMemoryResearchEvidencePayload({ memory: archive, research, timeZone: 'Asia/Tokyo' });
  const response = projectPublicMemoryResearchResponse({ research, ...evidence });

  assert.equal(research.searchPlan.mode, 'country');
  assert.equal(research.searchPlan.resolvedRegion?.code, 'JP');
  assert.equal(research.answerBoundary.status, 'supported');
  assert.deepEqual(research.authorizedRecordNoteIds, ['kyoto-happy-note', 'tokyo-happy-note']);
  assert.equal(research.authorizedRecordNoteIds.includes('shanghai-control-note'), false);
  assert.deepEqual(research.answerBoundary.verifiedPlaceNames, ['Japan']);
  assert.deepEqual(research.evidencePassages, []);
  assert.deepEqual(evidence.records.map(record => record.localDate), ['2026-07-11', '2026-07-10']);
  assert.equal(response.status, 'supported');
  assert.equal(response.evidence.records.length, 2);
  assert.equal(response.reasonCodes.includes('server-authorized-records'), true);
  assert.equal(response.reasonCodes.includes('verified-public-place-scope'), true);
  assert.equal(
    z.fromJSONSchema(MEMORY_RESEARCH_OUTPUT_SCHEMA)
      .safeParse(publicEnvelope(query, response)).success,
    true,
  );
});

test('evidence payload keeps authorization order while cleaning excerpts and summarizing routes', () => {
  const location = star('payload-star', 35, 139, at('2026-02-03'));
  const htmlNote = {
    ...note('payload-note', location.id, at('2026-02-03'), ''),
    content_html: '<p>Fallback <strong>synthetic text</strong></p><img data-media-key="synthetic/image.jpg">',
  };
  const route = track('payload-route', at('2026-02-03'), [[35, 139], [35.01, 139.01]]);
  const archive = memory([location], [htmlNote], [route]);
  const longPassage = `<p>${'Synthetic passage '.repeat(30)}</p>`;
  const evidence = buildMemoryResearchEvidencePayload({
    memory: archive,
    research: {
      authorizedRecordNoteIds: ['missing-note', 'payload-note', 'payload-note'],
      authorizedLocationStarIds: ['missing-star', 'payload-star', 'payload-star'],
      authorizedRouteTrackIds: ['missing-route', 'payload-route', 'payload-route'],
      evidencePassages: [{ noteId: 'payload-note', text: longPassage }],
      queryPlan: { routeIntent: true },
    },
    timeZone: 'Asia/Tokyo',
  });

  assert.deepEqual(evidence.records.map(record => record.id), ['payload-note']);
  assert.equal(evidence.records[0]?.excerpt.length, 240);
  assert.doesNotMatch(evidence.records[0]?.excerpt || '', /<[^>]+>/);
  assert.equal(evidence.records[0]?.hasImages, true);
  assert.equal(evidence.locations[0]?.noteCount, 1);
  assert.deepEqual(evidence.routes.map(item => item.id), ['payload-route']);
  assert.equal('paths' in (evidence.routes[0] || {}), false);

  const fallback = buildMemoryResearchEvidencePayload({
    memory: archive,
    research: {
      authorizedRecordNoteIds: ['payload-note'],
      evidencePassages: [],
      queryPlan: { routeIntent: false },
      authorizedRouteTrackIds: ['payload-route'],
    },
    timeZone: 'Asia/Tokyo',
  });
  assert.equal(fallback.records[0]?.excerpt, 'Fallback synthetic text');
  assert.deepEqual(fallback.routes, []);
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

test('public place ambiguity is explicit and never falls back to unrelated archive records', async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify([
    {
      name: 'Example Town',
      display_name: 'Example Town, North Region',
      lat: '35.0',
      lon: '139.0',
      boundingbox: ['34.9', '35.1', '138.9', '139.1'],
      addresstype: 'town',
      importance: 0.5,
      address: { country_code: 'xx' },
    },
    {
      name: 'Example Town',
      display_name: 'Example Town, South Region',
      lat: '25.0',
      lon: '129.0',
      boundingbox: ['24.9', '25.1', '128.9', '129.1'],
      addresstype: 'town',
      importance: 0.5,
      address: { country_code: 'xx' },
    },
  ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const resolution = await resolveMemoryPlace({
    place: 'Example Town',
    endpoint: 'https://resolver.example/ambiguous',
    latestCoordinate: { lat: 25, lng: 129 },
    fetchImpl,
  });
  const unrelated = star('unrelated', 31.2304, 121.4737, at('2026-07-10'));
  const research = researchMemoryContext(memory(
    [unrelated],
    [note('unrelated-note', unrelated.id, at('2026-07-10'), 'An unrelated memory.')],
  ), {
    query: 'Example Town memories',
    place: 'Example Town',
    placeResolution: resolution.summary,
  });

  assert.equal(resolution.summary.status, 'ambiguous');
  assert.equal(resolution.resolvedPlace, null);
  assert.equal(resolution.candidates.length, 2);
  assert.equal(research.searchPlan.mode, 'public-place-ambiguous');
  assert.deepEqual(research.selectedNoteIds, []);
  assert.deepEqual(research.selectedStarIds, []);
  assert.deepEqual(research.selectedTrackIds, []);
  assert.deepEqual(research.authorizedRecordNoteIds, []);
  assert.deepEqual(research.authorizedLocationStarIds, []);
  assert.deepEqual(research.authorizedRouteTrackIds, []);
  assert.deepEqual(research.selectedImageNoteIds, []);
  assert.match(research.instruction, /ask the user to disambiguate/i);
});

test('country matching distinguishes exact country names from city plus country', () => {
  assert.equal(resolveExactMemoryCountryRegion('日本')?.region.code, 'JP');
  assert.equal(resolveExactMemoryCountryRegion('Example Town, Japan'), null);
  assert.equal(resolveMemoryCountryRegion('Example Town, Japan')?.region.code, 'JP');
});

test('Latin country aliases require complete word or phrase boundaries', () => {
  assert.equal(resolveMemoryCountryRegion('Where did I see the animal?'), null);
  assert.equal(resolveMemoryCountryRegion('A token can contain an accidental country abbreviation.'), null);
  assert.equal(resolveMemoryCountryRegion('Memories from Japan')?.region.code, 'JP');
  assert.equal(resolveMemoryCountryRegion('A trip through the United Kingdom')?.region.code, 'GB');
});

test('MCP instructions require compositional research and prohibit invented memories', () => {
  assert.match(MCP_MEMORY_INSTRUCTIONS, /public country, city, town, village/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /place argument/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /home, workplace, school/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /latest saved memory is not proof of current location/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /candidate notes are unverified/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /not calibrated probabilities/i);
  assert.match(MCP_MEMORY_INSTRUCTIONS, /do not infer or invent/i);
});
