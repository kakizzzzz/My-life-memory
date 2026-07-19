import assert from 'node:assert/strict';
import test from 'node:test';
import { inferMemoryPlaceHint } from '../supabase/functions/_shared/mcp-query-routing.mjs';
import { buildMemoryQueryPlan } from '../supabase/functions/_shared/memory-query-plan.ts';

const privateAliasCorpus = [
  '麻烦看看我家附近的记录',
  '请查一下我的办公室',
  '我公司附近有什么',
  '我住的地方在哪里',
  'Could you look around my workplace?',
  'Show me where I live',
  'Notes near my school, please',
  '私の職場の近くを見せて',
  '私の学校はどこ？',
  '내 직장 근처 기록',
  '우리 집은 어디야?',
  'Show me 我家附近的 routes',
] as const;

test('golden corpus: private aliases never become public geocoder input', () => {
  for (const query of privateAliasCorpus) {
    assert.equal(inferMemoryPlaceHint(query), '', query);
  }
});

const publicPlaceCorpus = [
  ['我在示例城市看到海豚', '示例城市'],
  ['I saw it in Example City', 'Example City'],
  ['架空町で見た', '架空町'],
  ['가상마을에서 봤다', '가상마을'],
  ['帮我看看架空国旅行', '架空国'],
  ['Was my time in Example Town a trip or part of daily life?', 'Example Town'],
  ['架空村旅行の記録', '架空村'],
  ['가상도시 여행 기록', '가상도시'],
] as const;

test('golden corpus: explicit public places remain exact geocoder input', () => {
  for (const [query, place] of publicPlaceCorpus) {
    assert.equal(inferMemoryPlaceHint(query), place, query);
  }
});

type PlanExpectation = {
  query: string;
  mode?: 'direct-question' | 'reference-statement' | 'follow-up' | 'correction';
  anchor?: 'home' | 'work' | 'study';
  event?: 'observation' | 'activity';
  route?: boolean;
  image?: boolean;
  spatial?: 'exact' | 'nearby' | 'within-radius' | 'none';
  target?: string;
  place?: string;
  year?: string;
  relative?: boolean;
  intent?: 'locate' | 'list' | 'summarize' | 'classify' | 'compare';
};

const planCorpus: PlanExpectation[] = [
  { query: '麻烦帮我看看，我家附近走过哪些路线？', anchor: 'home', route: true, spatial: 'nearby' },
  { query: 'Could you show me what I ate near my office?', anchor: 'work', event: 'activity', spatial: 'nearby' },
  { query: '私の学校の近くで撮った写真を見せて', anchor: 'study', image: true, spatial: 'nearby' },
  { query: '내 직장 근처에서 달린 경로를 보여줘', anchor: 'work', route: true, spatial: 'nearby' },
  { query: '我在示例城市看到的海豚，帮我找一下', event: 'observation', target: '海豚', place: '示例城市' },
  { query: 'I saw a mural in Example City', event: 'observation', target: 'mural', place: 'Example City' },
  { query: '架空町で見たイルカ', event: 'observation', target: 'イルカ', place: '架空町' },
  { query: '那个小猫的地方很有趣', mode: 'reference-statement', event: 'observation', target: '小猫' },
  { query: '不是那个，我说的是我学校附近的路线', mode: 'correction', anchor: 'study', route: true, spatial: 'nearby' },
  { query: '第二个', mode: 'follow-up' },
  { query: '2024年我家附近有什么记录', anchor: 'home', year: '2024', spatial: 'nearby' },
  { query: '昨天看到的海豚', event: 'observation', target: '海豚', relative: true },
  { query: '这些记录是旅行还是日常？', intent: 'classify' },
  { query: '总结2025年的记录', intent: 'summarize', year: '2025' },
  { query: 'Show me 我家附近的 routes', anchor: 'home', route: true, spatial: 'nearby' },
  { query: '我在 Example Ctiy 看到的壁画', event: 'observation', target: '壁画', place: 'Example Ctiy' },
];

test('golden corpus: compositional intent facets stay separate across natural phrasing', () => {
  for (const expected of planCorpus) {
    const plan = buildMemoryQueryPlan({ query: expected.query });
    if (expected.mode) assert.equal(plan.utteranceMode, expected.mode, expected.query);
    if (expected.anchor) assert.equal(plan.anchorRelations.includes(expected.anchor), true, expected.query);
    if (expected.event) assert.equal(plan.eventRelations.includes(expected.event), true, expected.query);
    if (expected.route !== undefined) assert.equal(plan.routeIntent, expected.route, expected.query);
    if (expected.image !== undefined) assert.equal(plan.imageIntent, expected.image, expected.query);
    if (expected.spatial) assert.equal(plan.spatialRelation, expected.spatial, expected.query);
    if (expected.target) assert.equal(plan.targetTerms.includes(expected.target), true, expected.query);
    if (expected.place) assert.equal(plan.publicPlace?.value, expected.place, expected.query);
    if (expected.year) assert.equal(plan.dateRange?.dateFrom, `${expected.year}-01-01`, expected.query);
    if (expected.relative !== undefined) assert.equal(plan.relativeTimeNeedsResolution, expected.relative, expected.query);
    if (expected.intent) assert.equal(plan.answerIntent, expected.intent, expected.query);
  }
});
