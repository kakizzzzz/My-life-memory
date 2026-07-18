import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMemoryQueryPlan,
  inferMemoryQueryDateRange,
} from '../supabase/functions/_shared/memory-query-plan.ts';

test('query plan keeps home, observation, target, and nearby constraints separate', () => {
  const plan = buildMemoryQueryPlan({ query: '我家附近在哪里看到过海豚？' });

  assert.deepEqual(plan.anchorRelations, ['home']);
  assert.deepEqual(plan.eventRelations, ['observation']);
  assert.deepEqual(plan.targetTerms, ['海豚']);
  assert.equal(plan.spatialRelation, 'nearby');
  assert.equal(plan.publicPlace, null);
  assert.equal(plan.answerIntent, 'locate');
});

test('query plan composes explicit public place, year, observation, and target', () => {
  const plan = buildMemoryQueryPlan({ query: '看看我 2025 年在宁波看到的海豚' });

  assert.deepEqual(plan.publicPlace, { value: '宁波', source: 'query-span' });
  assert.deepEqual(plan.anchorRelations, []);
  assert.deepEqual(plan.eventRelations, ['observation']);
  assert.deepEqual(plan.targetTerms, ['海豚']);
  assert.deepEqual(plan.dateRange, {
    dateFrom: '2025-01-01',
    dateTo: '2025-12-31',
    precision: 'year',
    sourceText: '2025 年',
    matchedText: '2025 年',
  });
});

test('route intent does not leak route words into target terms', () => {
  const plan = buildMemoryQueryPlan({ query: '我家附近走过哪些路线' });

  assert.equal(plan.routeIntent, true);
  assert.deepEqual(plan.anchorRelations, ['home']);
  assert.deepEqual(plan.targetTerms, []);
});

test('relative dates require user-local resolution instead of silently searching all history', () => {
  for (const query of ['昨天看到的海豚', 'two weeks ago', '10日前', '3일 전']) {
    const plan = buildMemoryQueryPlan({ query });
    assert.equal(plan.relativeTimeNeedsResolution, true, query);
    assert.equal(plan.dateRange, null, query);
  }
});

test('explicit calendar ranges validate day, month, and leap-year boundaries', () => {
  assert.deepEqual(inferMemoryQueryDateRange('2024年2月29日的记录'), {
    dateFrom: '2024-02-29',
    dateTo: '2024-02-29',
    precision: 'day',
    sourceText: '2024年2月29日',
    matchedText: '2024年2月29日',
  });
  assert.equal(inferMemoryQueryDateRange('2025年2月29日的记录')?.precision, 'month');
  assert.deepEqual(inferMemoryQueryDateRange('2025-02'), {
    dateFrom: '2025-02-01',
    dateTo: '2025-02-28',
    precision: 'month',
    sourceText: '2025-02',
    matchedText: '2025-02',
  });
});
