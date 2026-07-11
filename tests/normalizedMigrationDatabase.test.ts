import test from 'node:test';

test('normalized migration executes, verifies, reruns, isolates users, and rolls back failures', async () => {
  await import('../scripts/verify-normalized-migration.mjs');
});
