import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import {
  clearMemoryMutationOutbox,
  enqueueMemoryMutations,
  readMemoryMutationOutbox,
  writeMemoryMutationOutbox,
} from '../src/lib/memoryOutbox';
import {
  compactMemoryMutations,
  partitionMemoryMutationsForSync,
  type MemoryMutation,
} from '../src/lib/normalizedMemory';
import {
  classifyMemorySyncError,
  memorySyncIssueSummary,
} from '../src/lib/memorySyncErrors';

Object.defineProperty(globalThis, 'indexedDB', {
  configurable: true,
  value: fakeIndexedDB,
});

const userId = '11111111-1111-4111-8111-111111111111';

const invalidRoute = (): MemoryMutation => ({
  mutationId: 'route-invalid-1',
  type: 'track_upsert',
  entityId: 'route-1',
  payload: {
    id: 'route-1',
    sortOrder: 0,
    paths: [[[30, 120], [Number.NaN, 120.1]]],
    durationSeconds: 10,
    distanceKm: 0.2,
  },
  base: null,
  createdAt: 1,
});

const validSettings = (): MemoryMutation => ({
  mutationId: 'settings-valid-1',
  type: 'settings_update',
  entityId: 'settings',
  payload: { mapStyle: 'dark', language: 'en' },
  base: { mapStyle: 'light', language: 'en' },
  createdAt: 2,
});

test('an invalid route stays in IndexedDB while unrelated valid changes remain sendable', async () => {
  await clearMemoryMutationOutbox(userId);
  await enqueueMemoryMutations({
    userId,
    expectedRevision: 7,
    mutations: [invalidRoute(), validSettings()],
    language: 'en',
  });

  const stored = await readMemoryMutationOutbox(userId);
  assert.ok(stored);
  const partition = partitionMemoryMutationsForSync(stored.mutations);
  assert.deepEqual(partition.valid.map(item => item.type), ['settings_update']);
  assert.deepEqual(partition.invalid.map(item => item.mutation.type), ['track_upsert']);
  assert.equal(stored.mutations.length, 2, 'the rejected route must not be silently discarded');

  const validation = classifyMemorySyncError(new Error(partition.invalid[0].message));
  await writeMemoryMutationOutbox({
    ...stored,
    lastError: memorySyncIssueSummary(validation),
    lastErrorInfo: { ...validation, kind: 'validation', retryable: false },
  });
  const failed = await readMemoryMutationOutbox(userId);
  assert.equal(failed?.lastErrorInfo?.kind, 'validation');
  assert.match(failed?.lastError || '', /invalid coordinate/i);
});

test('a corrected mutation replaces the blocked entity and restores a recoverable outbox', async () => {
  const correctedRoute: MemoryMutation = {
    ...invalidRoute(),
    mutationId: 'route-corrected-2',
    payload: {
      id: 'route-1',
      sortOrder: 0,
      paths: [[[30, 120], [30.001, 120.001]]],
      durationSeconds: 11,
      distanceKm: 0.2,
    },
    createdAt: 3,
  };

  await enqueueMemoryMutations({
    userId,
    expectedRevision: 7,
    mutations: [correctedRoute],
    language: 'en',
  });
  const stored = await readMemoryMutationOutbox(userId);
  assert.ok(stored);
  const partition = partitionMemoryMutationsForSync(stored.mutations);
  assert.equal(partition.invalid.length, 0);
  assert.deepEqual(new Set(partition.valid.map(item => item.type)), new Set(['settings_update', 'track_upsert']));
  assert.equal(partition.valid.find(item => item.type === 'track_upsert')?.mutationId, 'route-corrected-2');
  assert.equal(stored.lastErrorInfo?.kind, 'validation', 'the prior reason remains diagnostic until sync succeeds');

  await clearMemoryMutationOutbox(userId);
  assert.equal(await readMemoryMutationOutbox(userId), null, 'a successful sync can clean the outbox completely');
});

test('network and validation failures remain distinguishable and mutation compaction keeps local data', () => {
  const network = classifyMemorySyncError(new TypeError('Failed to fetch'));
  const validation = classifyMemorySyncError({
    code: '22023',
    message: 'Note HTML is invalid or unsafe',
    details: null,
    hint: null,
    status: 400,
  });
  assert.equal(network.kind, 'network');
  assert.equal(network.retryable, true);
  assert.equal(validation.kind, 'validation');
  assert.equal(validation.retryable, false);

  const compacted = compactMemoryMutations([invalidRoute(), validSettings()]);
  assert.equal(compacted.length, 2);
});
