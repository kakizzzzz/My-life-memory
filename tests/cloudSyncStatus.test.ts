import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCloudSyncStatus,
  registerCloudConflictResolver,
  resolveCloudConflict,
  setCloudSyncStatus,
  subscribeCloudSyncStatus,
} from '../src/lib/cloudSyncStatus';

test('publishes cloud sync phase changes and supports unsubscribe', () => {
  let notificationCount = 0;
  const unsubscribe = subscribeCloudSyncStatus(() => {
    notificationCount += 1;
  });

  setCloudSyncStatus('local', 'zh');
  assert.equal(getCloudSyncStatus().phase, 'local');
  assert.equal(getCloudSyncStatus().language, 'zh');
  assert.equal(notificationCount, 1);

  unsubscribe();
  setCloudSyncStatus('syncing', 'zh');
  assert.equal(notificationCount, 1);
});

test('routes an explicit cloud conflict choice to the registered resolver', async () => {
  const choices: string[] = [];
  registerCloudConflictResolver(async strategy => {
    choices.push(strategy);
  });

  await resolveCloudConflict('local');
  await resolveCloudConflict('merge');
  await resolveCloudConflict('cloud');
  assert.deepEqual(choices, ['local', 'merge', 'cloud']);
  registerCloudConflictResolver(null);
});
