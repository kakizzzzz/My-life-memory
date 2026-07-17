import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildSmallArchiveReview,
  resolvePersonalMemoryContext,
} from '../supabase/functions/_shared/memory-personal-context.ts';
import {
  inferMemoryQueryDateRange,
  researchMemoryContext,
  type ResolvedMemoryPlace,
} from '../supabase/functions/_shared/memory-research.ts';
import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
} from '../supabase/functions/_shared/memory-record-types.ts';

const at = (day: number) => Date.parse(`2026-07-${String(day).padStart(2, '0')}T12:00:00Z`);

const star = (id: string, lat: number, lng: number, day: number): StarRow => ({
  id,
  sort_order: 0,
  lat,
  lng,
  created_at_ms: at(day),
  tag_order: null,
  tag_group_id: null,
  color: '#cccccc',
});

const note = ({
  id,
  starId,
  day,
  title = '',
  content = '',
}: {
  id: string;
  starId: string;
  day: number;
  title?: string;
  content?: string;
}): NoteRow => ({
  star_id: starId,
  id,
  sort_order: 0,
  title,
  title_html: title ? `<p>${title}</p>` : '',
  content,
  content_html: content ? `<p>${content}</p>` : '',
  image_url: null,
  image_urls: [],
  images: [],
  font_size: null,
  title_font_size: null,
  color: null,
  created_at_ms: at(day),
  updated_at_ms: at(day),
});

const memory = (stars: StarRow[], notes: NoteRow[]): NormalizedMemoryRows => ({
  userId: 'user-1',
  account: 'kaki',
  profile: null,
  revision: 1,
  stars,
  notes,
  tracks: [],
});

test('personal nearby research anchors home from note evidence and returns only nearby memories', () => {
  const home = star('home', 31.2304, 121.4737, 1);
  const cafe = star('cafe', 31.2340, 121.4770, 2);
  const far = star('far', 30.2741, 120.1551, 3);
  const result = researchMemoryContext(memory(
    [home, cafe, far],
    [
      note({ id: 'home-note', starId: home.id, day: 1, content: '这里是我住的地方。' }),
      note({ id: 'cafe-note', starId: cafe.id, day: 2, title: '附近的咖啡店', content: '午后在这里看书。' }),
      note({ id: 'far-note', starId: far.id, day: 3, title: '远方散步', content: '在湖边散步。' }),
    ],
  ), { query: '查看我家附近的笔记', radiusKm: 2 });

  assert.equal(result.searchPlan.mode, 'personal-nearby');
  assert.equal(result.personalContext.status, 'resolved');
  assert.equal(result.personalContext.matchSource, 'content');
  assert.deepEqual(new Set(result.selectedNoteIds), new Set(['home-note', 'cafe-note']));
  assert.equal(result.selectedNoteIds.includes('far-note'), false);
  assert.equal(result.latestRecordedMemory, null);
});

test('titles are the first evidence layer and bodies are not rescanned after a title match', () => {
  const titleHome = star('title-home', 31.2, 121.4, 1);
  const bodyHome = star('body-home', 31.3, 121.5, 2);
  const resolved = resolvePersonalMemoryContext(memory(
    [titleHome, bodyHome],
    [
      note({ id: 'title-evidence', starId: titleHome.id, day: 1, title: '我的家', content: '普通的一天。' }),
      note({ id: 'body-evidence', starId: bodyHome.id, day: 2, title: '搬家', content: '这里是我家，我住在这里。' }),
    ],
  ), '我家附近', 5);

  assert.equal(resolved.matchSource, 'title');
  assert.deepEqual(resolved.anchors.map(anchor => anchor.starId), ['title-home']);
  assert.deepEqual(resolved.evidenceNoteIds, ['title-evidence']);
});

test('work, study, observation, and activity questions resolve from the user archive', () => {
  const office = star('office', 31.21, 121.41, 1);
  const school = star('school', 31.22, 121.42, 2);
  const dolphin = star('dolphin', 31.23, 121.43, 3);
  const pottery = star('pottery', 31.24, 121.44, 4);
  const archive = memory(
    [office, school, dolphin, pottery],
    [
      note({ id: 'office-note', starId: office.id, day: 1, content: '我每天在这间办公室上班。' }),
      note({ id: 'school-note', starId: school.id, day: 2, content: '我常在这间图书馆学习。' }),
      note({ id: 'dolphin-note', starId: dolphin.id, day: 3, content: '第一次在这里看见了海豚。' }),
      note({ id: 'pottery-note', starId: pottery.id, day: 4, content: '下午在这里做陶艺。' }),
    ],
  );

  assert.deepEqual(resolvePersonalMemoryContext(archive, '我工作的地方', 5).anchors.map(item => item.starId), ['office']);
  assert.deepEqual(resolvePersonalMemoryContext(archive, '我学习的地方', 5).anchors.map(item => item.starId), ['school']);
  assert.deepEqual(resolvePersonalMemoryContext(archive, '我看到海豚的地方', 5).anchors.map(item => item.starId), ['dolphin']);
  assert.deepEqual(resolvePersonalMemoryContext(archive, '我做陶艺的地方', 5).anchors.map(item => item.starId), ['pottery']);
});

test('explicit place narrows first, inferred year narrows second, then titles supply event evidence', () => {
  const ningbo2025 = star('ningbo-2025', 29.8683, 121.544, 1);
  const ningbo2026 = { ...star('ningbo-2026', 29.87, 121.55, 2), created_at_ms: Date.parse('2026-07-02T12:00:00Z') };
  const shanghai2025 = star('shanghai-2025', 31.2304, 121.4737, 3);
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
  const archive = memory(
    [ningbo2025, ningbo2026, shanghai2025],
    [
      { ...note({ id: 'target', starId: ningbo2025.id, day: 1, title: '看到海豚', content: '在水边停留了很久。' }), created_at_ms: Date.parse('2025-05-03T12:00:00Z') },
      note({ id: 'wrong-year', starId: ningbo2026.id, day: 2, title: '看到海豚', content: '另一年的记录。' }),
      { ...note({ id: 'wrong-place', starId: shanghai2025.id, day: 3, title: '看到海豚', content: '另一个城市。' }), created_at_ms: Date.parse('2025-06-03T12:00:00Z') },
    ],
  );
  const result = researchMemoryContext(archive, {
    query: '看看我2025年在示例城市看到的海豚',
    place: '示例城市',
    resolvedPlace,
  });

  assert.deepEqual(inferMemoryQueryDateRange('看看我2025年在示例城市看到的海豚'), {
    dateFrom: '2025-01-01',
    dateTo: '2025-12-31',
    precision: 'year',
    matchedText: '2025年',
  });
  assert.equal(result.searchPlan.resolvedRegion?.mode, 'place');
  assert.equal(result.searchPlan.dateFrom, '2025-01-01');
  assert.equal(result.searchPlan.dateTo, '2025-12-31');
  assert.equal(result.personalContext.matchSource, 'title');
  assert.deepEqual(result.selectedNoteIds, ['target']);
});

test('multiple identity anchors remain ambiguous instead of silently choosing one', () => {
  const oldHome = star('old-home', 31.2, 121.4, 1);
  const newHome = star('new-home', 31.3, 121.5, 2);
  const result = researchMemoryContext(memory(
    [oldHome, newHome],
    [
      note({ id: 'old-home-note', starId: oldHome.id, day: 1, content: '这里是我家，我住在这里。' }),
      note({ id: 'new-home-note', starId: newHome.id, day: 2, content: '这里是我家，我住在这里。' }),
    ],
  ), { query: '我家附近有什么记录' });

  assert.equal(result.personalContext.status, 'ambiguous');
  assert.equal(result.searchPlan.mode, 'personal-context-ambiguous');
  assert.deepEqual(new Set(result.selectedStarIds), new Set(['old-home', 'new-home']));
  assert.match(result.instruction, /disambiguate/i);
});

test('small archives expose every title before bounded title-and-body candidates', () => {
  const lunch = star('lunch', 31.2, 121.4, 1);
  const walk = star('walk', 31.3, 121.5, 2);
  const archive = memory(
    [lunch, walk],
    [
      note({ id: 'lunch-note', starId: lunch.id, day: 1, title: '午餐', content: '在博物馆附近吃了一顿饭。' }),
      note({ id: 'walk-note', starId: walk.id, day: 2, content: '沿着河边散步。' }),
    ],
  );
  const personal = resolvePersonalMemoryContext(archive, '我家附近的笔记', 5);
  const review = buildSmallArchiveReview(archive, personal);
  const result = researchMemoryContext(archive, { query: '我家附近的笔记' });

  assert.equal(personal.status, 'not-found');
  assert.equal(review.available, true);
  assert.deepEqual(new Set(review.titleNoteIds), new Set(['lunch-note', 'walk-note']));
  assert.deepEqual(new Set(review.candidateNoteIds), new Set(['lunch-note', 'walk-note']));
  assert.deepEqual(result.selectedNoteIds, []);
  assert.deepEqual(result.selectedStarIds, []);
  assert.deepEqual(result.selectedTrackIds, []);
  assert.deepEqual(new Set(result.titleNoteIds), new Set(['lunch-note', 'walk-note']));
  assert.deepEqual(new Set(result.candidateNoteIds), new Set(['lunch-note', 'walk-note']));
  assert.match(result.instruction, /candidates are not evidence/i);
  assert.match(result.instruction, /do not describe unrelated records/i);
});

test('large archives do not bulk-return note bodies for candidate review', () => {
  const stars = Array.from({ length: 41 }, (_, index) => star(`star-${index}`, 31 + index / 1_000, 121, 1));
  const notes = stars.map((item, index) => note({
    id: `note-${index}`,
    starId: item.id,
    day: 1,
    title: `记录 ${index}`,
    content: '普通内容。',
  }));
  const result = researchMemoryContext(memory(stars, notes), { query: '我家附近的笔记' });

  assert.equal(result.candidateReview.available, false);
  assert.deepEqual(result.titleNoteIds, []);
  assert.deepEqual(result.candidateNoteIds, []);
  assert.match(result.instruction, /do not substitute/i);
});

test('Memory API keeps title review and body candidates separate from evidence records', () => {
  const source = readFileSync(new URL('../supabase/functions/memory-api/index.ts', import.meta.url), 'utf8');
  assert.match(source, /titleIndex/);
  assert.match(source, /candidateNotes/);
  assert.match(source, /retrievalRole: 'title-index'/);
  assert.match(source, /retrievalRole: 'candidate-only'/);
  assert.match(source, /records: notes/);
});
