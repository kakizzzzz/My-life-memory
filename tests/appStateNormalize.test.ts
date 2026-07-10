import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePersistedAppState } from '../src/lib/appStateNormalize';

test('normalizes account data and removes invalid map records', () => {
  const normalized = normalizePersistedAppState({
    profile: {
      name: 'Kaki',
      account: '  Test-Account  ',
      password: 'must-not-survive-normalization',
    },
    stars: [
      {
        id: 'valid-star',
        lat: 31.2,
        lng: 121.4,
        notes: [{ id: 'note-1', title: 'Hello', content: 'World' }],
      },
      {
        id: 'invalid-star',
        lat: 999,
        lng: 121.4,
      },
    ],
    savedTracks: [
      {
        id: 'valid-track',
        paths: [
          [[31.2, 121.4], [31.21, 121.41]],
          [[999, 121.4], [31.3, 121.5]],
        ],
        distance: -10,
      },
      {
        id: 'invalid-track',
        paths: [[[999, 121.4], [998, 121.5]]],
      },
    ],
  });

  assert.equal(normalized.profile.account, 'test-account');
  assert.equal('password' in normalized.profile, false);
  assert.deepEqual(normalized.stars.map(star => star.id), ['valid-star']);
  assert.equal(normalized.savedTracks.length, 1);
  assert.deepEqual(normalized.savedTracks[0].paths, [[[31.2, 121.4], [31.21, 121.41]]]);
  assert.equal(normalized.savedTracks[0].distance, 0);
});
