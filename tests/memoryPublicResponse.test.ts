import assert from 'node:assert/strict';
import test from 'node:test';
import * as z from 'zod/v4';
import { MEMORY_RESEARCH_OUTPUT_SCHEMA } from '../supabase/functions/_shared/mcp-memory-public-schema.mjs';
import {
  memoryResearchTextContent,
  projectPublicMemoryResearchResponse,
} from '../supabase/functions/_shared/memory-public-response.ts';

const forbiddenKeys = new Set([
  'candidateNotes', 'candidateReview', 'titleIndex', 'clusters', 'latestRecordedMemory',
  'totals', 'personalContext', 'selectedNoteIds', 'selectedStarIds', 'selectedTrackIds',
  'decisionReasons', 'semanticReview', 'scores',
]);

const collectKeys = (value: unknown, keys = new Set<string>()) => {
  if (Array.isArray(value)) value.forEach(item => collectKeys(item, keys));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
    keys.add(key);
    collectKeys(item, keys);
  });
  return keys;
};

const visibleStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(visibleStrings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(visibleStrings);
};

const wrapped = (query: string, response: Record<string, unknown>) => ({
  ok: true,
  source: 'my-life-memory-normalized-v2',
  action: 'research_memory_context',
  query,
  timestamp: '2026-07-18T00:00:00.000Z',
  temporalContext: {
    timeZone: 'UTC',
    currentUtcDateTime: '2026-07-18T00:00:00.000Z',
    currentLocalDate: '2026-07-18',
    currentLocalDateTime: '2026-07-18T00:00:00',
    currentDateRole: 'query-evaluation-only',
  },
  ...response,
});

test('supported research exposes only bounded evidence allowlist fields', () => {
  const result = projectPublicMemoryResearchResponse({
    research: {
      query: 'Where did I see the sculpture?',
      answerBoundary: { status: 'supported', verifiedPlaceNames: [] },
      queryPlan: {
        originalQuery: 'Where did I see the sculpture?',
        answerIntent: 'locate',
        anchorRelations: [],
        eventRelations: ['observation'],
        routeIntent: false,
      },
      evidencePassages: [{
        noteId: 'note-1',
        starId: 'star-1',
        role: 'target',
        source: 'body',
        text: 'I saw the sculpture here.',
        relation: 'observation',
        createdAt: 1,
        coordinates: { lat: 35, lng: 139 },
        hiddenInternalScore: 999,
      }],
      selectedImageNoteIds: ['note-1', 'other-note'],
      confidenceBand: 'high',
      candidateReview: { candidateExcerpts: ['must not escape'] },
    },
    records: [{
      id: 'note-1',
      starId: 'star-1',
      title: 'Sculpture',
      excerpt: 'I saw the sculpture here.',
      createdAt: 1,
      hasImages: true,
      coordinates: { lat: 35, lng: 139 },
    }],
    locations: [{ id: 'star-1', index: 0, coordinates: { lat: 35, lng: 139 }, noteCount: 1 }],
  });

  assert.equal(result.status, 'supported');
  assert.equal(result.directive.action, 'ANSWER_FROM_EVIDENCE');
  assert.equal(result.evidence.passages.length, 1);
  assert.equal(result.evidence.passages[0].excerpt, 'I saw the sculpture here.');
  assert.equal('hiddenInternalScore' in result.evidence.passages[0], false);
  assert.equal(JSON.stringify(result).includes('must not escape'), false);
  assert.deepEqual(result.evidence.selectedImageNoteIds, ['note-1']);
});

test('not-found response physically omits every candidate and coordinate-bearing path', () => {
  const result = projectPublicMemoryResearchResponse({
    research: {
      query: 'Where is the place I meant?',
      answerBoundary: { status: 'not-found' },
      queryPlan: { originalQuery: 'Where is the place I meant?' },
      candidateNotes: [{ title: 'Private candidate', body: 'Sensitive candidate body' }],
      candidateReview: { coordinates: { lat: 1, lng: 2 } },
      selectedNoteIds: ['candidate-1'],
      selectedImageNoteIds: ['candidate-1'],
      latestRecordedMemory: { coordinates: { lat: 1, lng: 2 } },
      totals: { notes: 100 },
      classification: { label: 'daily' },
    },
  });

  assert.equal(result.status, 'not-found');
  assert.equal(result.evidence, null);
  assert.equal(result.directive.action, 'STATE_NO_EVIDENCE_EXACT');
  const keys = collectKeys(result);
  forbiddenKeys.forEach(key => assert.equal(keys.has(key), false, `unexpected key ${key}`));
  const weakClientView = visibleStrings(result).join(' ');
  assert.doesNotMatch(weakClientView, /Private candidate|Sensitive candidate body|candidate-1/u);
  assert.equal(memoryResearchTextContent(result), result.directive.exactText);
});

test('ambiguous response contains only neutral options and an opaque continuation token', () => {
  const result = projectPublicMemoryResearchResponse({
    research: {
      query: 'Which personal place did I mean?',
      answerBoundary: { status: 'not-found' },
      queryPlan: { originalQuery: 'Which personal place did I mean?' },
    },
    referenceClarification: {
      exactText: 'Do you mean Possible location 1 or Possible location 2?',
      kind: 'choose-option',
      options: [
        { optionId: 'o1', label: 'Possible location 1' },
        { optionId: 'o2', label: 'Possible location 2' },
      ],
      continuationToken: 'opaque-token',
      requestedFacets: ['time', 'place'],
    },
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.directive.action, 'ASK_USER_EXACT');
  assert.deepEqual(result.clarification.options.map(option => option.label), [
    'Possible location 1',
    'Possible location 2',
  ]);
  assert.equal(result.evidence, null);
  assert.equal(memoryResearchTextContent(result), result.directive.exactText);
});

test('supported deterministic evidence wins over a stale clarification object', () => {
  const result = projectPublicMemoryResearchResponse({
    research: {
      query: 'Where did I work?',
      answerBoundary: { status: 'supported', verifiedPlaceNames: [] },
      queryPlan: {
        originalQuery: 'Where did I work?',
        answerIntent: 'locate',
        anchorRelations: ['work'],
        eventRelations: [],
        routeIntent: false,
      },
      evidencePassages: [],
      selectedImageNoteIds: [],
      confidenceBand: 'medium',
    },
    referenceClarification: {
      exactText: 'Stale clarification',
      kind: 'request-facet',
      options: [],
      continuationToken: null,
      requestedFacets: ['time'],
    },
  });

  assert.equal(result.status, 'supported');
  assert.equal(JSON.stringify(result).includes('Stale clarification'), false);
});

test('classification is emitted only for a supported classify request', () => {
  const result = projectPublicMemoryResearchResponse({
    research: {
      query: 'Was this travel or daily life?',
      answerBoundary: { status: 'supported', verifiedPlaceNames: [] },
      queryPlan: {
        originalQuery: 'Was this travel or daily life?',
        answerIntent: 'classify',
        anchorRelations: [],
        eventRelations: [],
        routeIntent: false,
      },
      evidencePassages: [],
      selectedImageNoteIds: [],
      confidenceBand: 'low',
      classification: { label: 'travel', confidenceBand: 'medium' },
    },
  });

  assert.equal(result.status, 'supported');
  assert.equal(result.classification?.label, 'travel');
  assert.equal(result.classification?.confidenceKind, 'heuristic');
});

test('the advertised MCP output schema accepts strict states and rejects extra fields', () => {
  const schema = z.fromJSONSchema(MEMORY_RESEARCH_OUTPUT_SCHEMA);
  const result = projectPublicMemoryResearchResponse({
    research: {
      query: 'Unknown memory',
      answerBoundary: { status: 'not-found' },
      queryPlan: { originalQuery: 'Unknown memory' },
    },
  });

  assert.equal(schema.safeParse(wrapped('Unknown memory', result)).success, true);
  assert.equal(schema.safeParse(wrapped('Unknown memory', {
    ...result,
    candidateNotes: ['forbidden'],
  })).success, false);
});
