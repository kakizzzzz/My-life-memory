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
import { applyMemoryResearchDisclosureBoundary } from '../supabase/functions/_shared/memory-public-response.ts';
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

test('a weak title never suppresses stronger direct body evidence elsewhere', () => {
  const titleHome = star('title-home', 31.2, 121.4, 1);
  const bodyHome = star('body-home', 31.3, 121.5, 2);
  const resolved = resolvePersonalMemoryContext(memory(
    [titleHome, bodyHome],
    [
      note({ id: 'title-evidence', starId: titleHome.id, day: 1, title: '我的家乡旅行', content: '普通的一天。' }),
      note({ id: 'body-evidence', starId: bodyHome.id, day: 2, title: '搬家', content: '这里是我家，我住在这里。' }),
    ],
  ), '我家附近', 5);

  assert.equal(resolved.matchSource, 'content');
  assert.deepEqual(resolved.anchors.map(anchor => anchor.starId), ['body-home']);
  assert.deepEqual(resolved.evidenceNoteIds, ['body-evidence']);
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
    sourceText: '2025年',
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

test('the first unresolved public response withholds all unverified candidate text', () => {
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
  assert.deepEqual(review.titleNoteIds, []);
  assert.equal(review.candidateNoteIds.length > 0, true);
  assert.deepEqual(result.selectedNoteIds, []);
  assert.deepEqual(result.selectedStarIds, []);
  assert.deepEqual(result.selectedTrackIds, []);
  assert.equal(result.semanticReview.phase, 'not-needed');
  const disclosed = applyMemoryResearchDisclosureBoundary(result as unknown as Record<string, unknown>);
  assert.equal(disclosed.status, 'not-found');
  assert.equal(disclosed.evidence, null);
  assert.doesNotMatch(JSON.stringify(disclosed), /candidate|titleIndex|coordinates|午餐|河边/u);
});

test('legacy candidate requests cannot expose small-archive candidate text publicly', () => {
  const possibleHome = star('possible-home', 31.2, 121.4, 1);
  const unrelated = star('unrelated', 31.3, 121.5, 2);
  const archive = memory(
    [possibleHome, unrelated],
    [
      note({ id: 'possible', starId: possibleHome.id, day: 1, title: '搬家记录', content: '我家附近有一家咖啡店，但这句话没有确认这个坐标就是我家。' }),
      note({ id: 'unrelated-note', starId: unrelated.id, day: 2, title: '公园', content: '普通的散步。' }),
    ],
  );
  const result = researchMemoryContext(archive, {
    query: '我家附近的笔记',
    semanticReview: { requestCandidates: true, candidateOffset: 0 },
  });

  assert.deepEqual(result.selectedNoteIds, []);
  assert.equal(result.semanticReview.candidatesExposed, false);
  assert.equal(result.candidateNoteIds[0], 'possible');
  assert.equal(result.candidateReview.candidateExcerpts.length <= 4, true);
  assert.equal(result.candidateReview.candidateExcerpts[0].excerpts.length <= 2, true);
  assert.equal(result.candidateReview.candidateExcerpts[0].excerpts.every(excerpt => excerpt.length <= 240), true);
  const disclosed = applyMemoryResearchDisclosureBoundary(result as unknown as Record<string, unknown>);
  assert.equal(disclosed.status, 'not-found');
  assert.doesNotMatch(JSON.stringify(disclosed), /possible|搬家|咖啡店|candidate/u);
});

test('large archives may rank internally but never disclose candidate batches', () => {
  const stars = Array.from({ length: 41 }, (_, index) => star(`star-${index}`, 31 + index / 1_000, 121, 1));
  const notes = stars.map((item, index) => note({
    id: `note-${index}`,
    starId: item.id,
    day: 1,
    title: `记录 ${index}`,
    content: index === 40 ? '我家附近有一家店，但没有说明这个星标就是家。' : '普通内容。',
  }));
  const result = researchMemoryContext(memory(stars, notes), {
    query: '我家附近的笔记',
    semanticReview: { requestCandidates: true, candidateOffset: 0 },
  });

  assert.equal(result.candidateReview.available, true);
  assert.deepEqual(result.titleNoteIds, []);
  assert.equal(result.candidateNoteIds[0], 'note-40');
  assert.equal(result.candidateReview.candidateExcerpts.length <= 4, true);
  assert.equal(result.candidateReview.candidateExcerpts[0].excerpts.length, 1);
  assert.equal(result.semanticReview.candidatesExposed, false);
  const disclosed = applyMemoryResearchDisclosureBoundary(result as unknown as Record<string, unknown>);
  assert.equal(disclosed.status, 'not-found');
  assert.doesNotMatch(JSON.stringify(disclosed), /note-40|candidate|普通内容/u);
});

test('Memory API projects research through the strict public response boundary', () => {
  const source = readFileSync(new URL('../supabase/functions/memory-api/index.ts', import.meta.url), 'utf8');
  assert.match(source, /projectPublicMemoryResearchResponse/);
  assert.match(source, /referenceConfirmation/);
  assert.doesNotMatch(source, /publicResearch\.(?:candidateNotes|candidateReview|titleIndex)/u);
});
