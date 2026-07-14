import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type MediaDeletionQueueItem,
  runMediaRetentionCycle,
} from '../supabase/functions/_shared/media-retention-core.ts';

const item = (overrides: Partial<MediaDeletionQueueItem> = {}): MediaDeletionQueueItem => ({
  queue_id: 1,
  user_id: '11111111-1111-4111-8111-111111111111',
  bucket: 'life-media',
  path: '11111111-1111-4111-8111-111111111111/notes/note/image.jpg',
  attempts: 1,
  ...overrides,
});

test('scheduled media retention deletes only unprotected user-scoped objects', async () => {
  const removed: string[] = [];
  const completed: number[] = [];
  const failed: number[] = [];
  const protectedItem = item({ queue_id: 2, path: `${item().user_id}/notes/active/image.jpg` });
  const result = await runMediaRetentionCycle({
    purgeExpiredTrash: async () => ({ deletedNotes: 1 }),
    claimDue: async () => [item(), protectedItem],
    isProtected: async candidate => candidate.queue_id === protectedItem.queue_id,
    removeObject: async candidate => { removed.push(candidate.path); },
    complete: async queueId => { completed.push(queueId); },
    fail: async queueId => { failed.push(queueId); },
  }, { maxBatches: 1 });

  assert.deepEqual(removed, [item().path]);
  assert.deepEqual(completed.sort(), [1, 2]);
  assert.deepEqual(failed, []);
  assert.equal(result.deleted, 1);
  assert.equal(result.protected, 1);
  assert.equal(result.failed, 0);
});

test('scheduled media retention keeps failed and cross-account deletions queued', async () => {
  const failures: Array<{ id: number; message: string; retry: number }> = [];
  const invalid = item({ queue_id: 3, path: 'another-user/notes/note/image.jpg' });
  const storageFailure = item({ queue_id: 4, path: `${item().user_id}/notes/note/failure.jpg`, attempts: 2 });
  const result = await runMediaRetentionCycle({
    purgeExpiredTrash: async () => ({}),
    claimDue: async () => [invalid, storageFailure],
    isProtected: async () => false,
    removeObject: async candidate => {
      if (candidate.queue_id === storageFailure.queue_id) throw new Error('Storage unavailable');
    },
    complete: async () => { throw new Error('Unexpected completion'); },
    fail: async (id, message, retry) => { failures.push({ id, message, retry }); },
  }, { maxBatches: 1, concurrency: 2 });

  assert.equal(result.deleted, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(failures.map(entry => entry.id).sort(), [3, 4]);
  assert.match(failures.find(entry => entry.id === 3)?.message || '', /cross-account/i);
  assert.ok(failures.every(entry => entry.retry >= 15 * 60));
});

test('scheduled media retention never exceeds configured concurrency', async () => {
  const items = Array.from({ length: 12 }, (_, index) => item({
    queue_id: index + 1,
    path: `${item().user_id}/notes/note/${index}.jpg`,
  }));
  let active = 0;
  let maximum = 0;

  await runMediaRetentionCycle({
    purgeExpiredTrash: async () => ({}),
    claimDue: async () => items,
    isProtected: async () => false,
    removeObject: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
    },
    complete: async () => {},
    fail: async () => {},
  }, { maxBatches: 1, concurrency: 3 });

  assert.equal(maximum, 3);
});
