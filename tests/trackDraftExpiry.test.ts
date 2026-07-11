import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTrackDraftExpired,
  TRACK_DRAFT_MAX_AGE_MS,
} from '../src/lib/localPersistence';

test('expires abandoned precise-location drafts after seven days', () => {
  const now = Date.now();
  assert.equal(isTrackDraftExpired(now - TRACK_DRAFT_MAX_AGE_MS + 1, now), false);
  assert.equal(isTrackDraftExpired(now - TRACK_DRAFT_MAX_AGE_MS - 1, now), true);
  assert.equal(isTrackDraftExpired(0, now), true);
});
