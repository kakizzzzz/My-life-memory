import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCloudSnapshots } from '../src/lib/cloudSnapshotCompare';

const profile = { account: 'owner', name: 'Owner', avatarUrl: '' };
const state = {
  language: 'zh',
  stars: [{ id: 'star-1', lat: 31.2, lng: 121.4, notes: [] }],
  savedTracks: [],
};

test('recognizes an already-uploaded pending snapshot despite object key order', () => {
  const reorderedState = {
    savedTracks: [],
    stars: [{ notes: [], lng: 121.4, lat: 31.2, id: 'star-1' }],
    language: 'zh',
  };
  assert.deepEqual(compareCloudSnapshots(state, profile, reorderedState, profile), {
    stateEqual: true,
    profileEqual: true,
  });
});

test('keeps a real note difference classified as a conflict', () => {
  const changed = {
    ...state,
    stars: [{ ...state.stars[0], notes: [{ id: 'n1', title: '', content: 'changed' }] }],
  };
  assert.equal(compareCloudSnapshots(state, profile, changed, profile).stateEqual, false);
});

test('detects profile-only differences separately from app state', () => {
  const comparison = compareCloudSnapshots(
    state,
    profile,
    state,
    { ...profile, name: 'New name' }
  );
  assert.equal(comparison.stateEqual, true);
  assert.equal(comparison.profileEqual, false);
});
