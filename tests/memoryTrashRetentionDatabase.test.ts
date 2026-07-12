import test from 'node:test';

test('seven-day trash retention purges only expired user data and releases media paths', async () => {
  await import('../scripts/verify-memory-trash-retention.mjs');
});
