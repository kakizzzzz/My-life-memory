import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  contextualSearchInput,
  inferExplicitPlaceFromPersonalEvent,
  inferMemoryPlaceHint,
  isPersonalMemoryContextQuery,
  isSafePublicPlaceCandidate,
  mergeContextualSearchFallback,
  shouldUseContextualSearchFallback,
} from '../supabase/functions/_shared/mcp-query-routing.mjs';

test('natural memory queries expose only a compact place hint', () => {
  assert.equal(inferMemoryPlaceHint('日本旅行'), '日本');
  assert.equal(inferMemoryPlaceHint('帮我看看我在示例城市那次旅行的记录'), '示例城市');
  assert.equal(inferMemoryPlaceHint('Was my time in Example City a trip or part of daily life?'), 'Example City');
  assert.equal(inferMemoryPlaceHint('架空町旅行の記録'), '架空町');
  assert.equal(inferMemoryPlaceHint('가상마을 여행 기록'), '가상마을');
});

test('private personal-place phrases never become public geocoder hints', () => {
  const queries = [
    '查看我家附近的笔记',
    '我的办公室',
    '我的学校',
    '我公司',
    '我的工作地点',
    '我住的地方',
    '我工作的地方有什么记录',
    '我学习的地方',
    '我看到海豚的地方',
    '我做陶艺的地方',
    'Where I saw the old train',
    'my office',
    'my house',
    'my hometown',
    'my workplace',
    'my school',
    'where I live',
    'place where I work',
    '私の職場',
    '私の地元',
    '私の学校',
    '내 직장',
    '내 사무실',
    '우리 집',
  ];
  queries.forEach(query => {
    assert.equal(isPersonalMemoryContextQuery(query), true, query);
    assert.equal(inferMemoryPlaceHint(query), '', query);
  });
  for (const value of queries) assert.equal(isSafePublicPlaceCandidate(value), false, value);
  assert.deepEqual(contextualSearchInput({ query: '查看我家附近的笔记' }), {
    query: '查看我家附近的笔记',
    limit: 20,
  });
});

test('an explicit public place inside a personal event query remains the first spatial scope', () => {
  assert.equal(inferExplicitPlaceFromPersonalEvent('看看我2025年在示例城市看到的海豚'), '示例城市');
  assert.equal(inferMemoryPlaceHint('看看我2025年在示例城市看到的海豚'), '示例城市');
  assert.equal(inferMemoryPlaceHint('我在家看到一只猫'), '');
  assert.deepEqual(contextualSearchInput({ query: '看看我2025年在示例城市看到的海豚' }), {
    query: '看看我2025年在示例城市看到的海豚',
    place: '示例城市',
    placeSource: 'query-span',
    limit: 20,
  });
});

test('multilingual public event places remain exact positive geocoder inputs', () => {
  const cases = [
    ['我在宁波看到海豚', '宁波'],
    ['I saw it in Example City', 'Example City'],
    ['藤沢で見た', '藤沢'],
    ['부산에서 봤다', '부산'],
  ] as const;
  for (const [query, expected] of cases) {
    assert.equal(inferExplicitPlaceFromPersonalEvent(query), expected, query);
    assert.equal(inferMemoryPlaceHint(query), expected, query);
    assert.equal(isSafePublicPlaceCandidate(expected), true, expected);
    assert.equal(isSafePublicPlaceCandidate(query), false, query);
  }
});

test('public geocoder gate rejects generated combinations of private possessives and relations', () => {
  const privateCandidates = [
    ...['my', 'our'].flatMap(owner => ['home', 'office', 'workplace', 'school'].map(place => `${owner} ${place}`)),
    ...['我的', '我们的'].flatMap(owner => ['家', '办公室', '工作地点', '学校'].map(place => `${owner}${place}`)),
    ...['私の', '僕の'].flatMap(owner => ['家', '職場', '学校'].map(place => `${owner}${place}`)),
    ...['내', '나의', '우리'].flatMap(owner => ['집', '직장', '학교'].map(place => `${owner} ${place}`)),
  ];

  privateCandidates.forEach(candidate => assert.equal(isSafePublicPlaceCandidate(candidate), false, candidate));
});

test('ordinary targets without explicit geographic intent never become geocoder hints', () => {
  const nonPlaces = ['海豚', '找找海豚', '陶艺', 'dolphins', 'blue pottery', 'イルカ', '도자기'];
  nonPlaces.forEach(query => assert.equal(inferMemoryPlaceHint(query), '', query));
});

test('zero literal results retry context while exact matches remain exact', () => {
  const input = { query: '日本旅行', dateFrom: '2026-01-01', limit: 10 };
  assert.equal(shouldUseContextualSearchFallback({ count: 0 }, input), true);
  assert.equal(shouldUseContextualSearchFallback({ count: 1 }, input), false);
  assert.equal(shouldUseContextualSearchFallback({ count: 0 }, { query: '' }), false);
  assert.deepEqual(contextualSearchInput(input), {
    query: '日本旅行',
    place: '日本',
    placeSource: 'query-span',
    dateFrom: '2026-01-01',
    limit: 10,
  });
});

test('contextual fallback remains explicit and preserves returned evidence', () => {
  const merged = mergeContextualSearchFallback(
    { query: '日本旅行', count: 0, records: [] },
    {
      ok: true,
      count: 2,
      records: [{ id: 'note-1' }, { id: 'note-2' }],
      classification: { label: 'travel', confidence: 0.84 },
    },
  );
  assert.equal(merged.action, 'search_memories');
  assert.equal(merged.resolvedAction, 'research_memory_context');
  assert.equal(merged.retrievalMode, 'contextual-research-fallback');
  assert.equal(merged.count, 2);
  assert.deepEqual(merged.exactSearch, { query: '日本旅行', count: 0 });
  assert.deepEqual(merged.records, [{ id: 'note-1' }, { id: 'note-2' }]);
});

test('cloud and local MCP transports both enforce the same fallback routing', () => {
  const cloud = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
  const local = readFileSync(new URL('../mcp/memory-server.mjs', import.meta.url), 'utf8');
  for (const source of [cloud, local]) {
    assert.match(source, /shouldUseContextualSearchFallback/);
    assert.match(source, /research_memory_context/);
    assert.match(source, /contextualSearchInput/);
    assert.match(source, /mergeContextualSearchFallback/);
  }
});

test('Memory API applies the same safe query-span extraction to direct research calls', () => {
  const memoryApi = readFileSync(new URL('../supabase/functions/memory-api/index.ts', import.meta.url), 'utf8');
  assert.match(memoryApi, /inferredQueryPlace = !place && !region \? inferMemoryPlaceHint\(query\) : ''/);
  assert.match(memoryApi, /isSafePublicPlaceCandidate\(requestedPlace\)/);
  assert.match(memoryApi, /privatePlaceReference && publicPlaceCandidate/);
});
