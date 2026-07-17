import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  contextualSearchInput,
  inferExplicitPlaceFromPersonalEvent,
  inferMemoryPlaceHint,
  isPersonalMemoryContextQuery,
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
    '我工作的地方有什么记录',
    '我学习的地方',
    '我看到海豚的地方',
    '我做陶艺的地方',
    'Where I saw the old train',
  ];
  queries.forEach(query => {
    assert.equal(isPersonalMemoryContextQuery(query), true, query);
    assert.equal(inferMemoryPlaceHint(query), '', query);
  });
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
    limit: 20,
  });
});

test('zero literal results retry context while exact matches remain exact', () => {
  const input = { query: '日本旅行', dateFrom: '2026-01-01', limit: 10 };
  assert.equal(shouldUseContextualSearchFallback({ count: 0 }, input), true);
  assert.equal(shouldUseContextualSearchFallback({ count: 1 }, input), false);
  assert.equal(shouldUseContextualSearchFallback({ count: 0 }, { query: '' }), false);
  assert.deepEqual(contextualSearchInput(input), {
    query: '日本旅行',
    place: '日本',
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
