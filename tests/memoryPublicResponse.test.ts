import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMemoryResearchDisclosureBoundary,
  withoutMemoryCoordinates,
} from '../supabase/functions/_shared/memory-public-response.ts';

test('explicit candidate review keeps bounded text but removes coordinate-bearing answer paths', () => {
  const result = applyMemoryResearchDisclosureBoundary({
    answerBoundary: { mayStateCoordinates: false },
    semanticReview: { candidatesExposed: true },
    personalContext: {
      status: 'ambiguous',
      anchors: [{ starId: 'home-a', coordinates: { lat: 31.2, lng: 121.4 } }],
      evidencePassages: [{ noteId: 'note-a', text: '这里是我家。', coordinates: { lat: 31.2, lng: 121.4 } }],
    },
    evidencePassages: [{ noteId: 'note-a', text: '这里是我家。', coordinates: { lat: 31.2, lng: 121.4 } }],
    candidateReview: { candidateNoteIds: ['candidate-a'] },
    clusters: [{ center: { lat: 31.2, lng: 121.4 } }],
    latestRecordedMemory: { coordinates: { lat: 31.2, lng: 121.4 } },
    selectedImageNoteIds: ['note-a'],
    selectedStarIds: ['home-a'],
    selectedTrackIds: ['route-a'],
  });

  assert.deepEqual(result.personalContext.anchors, [{ starId: 'home-a' }]);
  assert.deepEqual(result.personalContext.evidencePassages, [{ noteId: 'note-a', text: '这里是我家。' }]);
  assert.deepEqual(result.evidencePassages, [{ noteId: 'note-a', text: '这里是我家。' }]);
  assert.deepEqual(result.candidateReview, { candidateNoteIds: ['candidate-a'] });
  assert.deepEqual(result.clusters, []);
  assert.equal(result.latestRecordedMemory, null);
  assert.deepEqual(result.selectedImageNoteIds, []);
  assert.deepEqual(result.selectedStarIds, []);
  assert.deepEqual(result.selectedTrackIds, []);
});

test('the first unresolved response physically withholds candidate payloads', () => {
  const result = applyMemoryResearchDisclosureBoundary({
    answerBoundary: { mayStateCoordinates: false },
    semanticReview: { candidatesExposed: false },
    candidateReview: {
      titleNoteIds: ['candidate-a'],
      candidateNoteIds: ['candidate-a'],
      candidateExcerpts: [{ noteId: 'candidate-a', excerpts: ['unverified'] }],
    },
    titleNoteIds: ['candidate-a'],
    candidateNoteIds: ['candidate-a'],
  });

  assert.deepEqual(result.titleNoteIds, []);
  assert.deepEqual(result.candidateNoteIds, []);
  assert.deepEqual(result.candidateReview, {
    titleNoteIds: [],
    candidateNoteIds: [],
    candidateExcerpts: [],
  });
});

test('supported research remains unchanged and record redaction removes coordinate aliases', () => {
  const supported = {
    answerBoundary: { mayStateCoordinates: true },
    selectedStarIds: ['home-a'],
  };
  assert.equal(applyMemoryResearchDisclosureBoundary(supported), supported);
  assert.deepEqual(withoutMemoryCoordinates({
    id: 'note-a',
    lat: 31.2,
    lng: 121.4,
    coordinates: { lat: 31.2, lng: 121.4 },
    text: 'evidence',
  }), { id: 'note-a', text: 'evidence' });
});
