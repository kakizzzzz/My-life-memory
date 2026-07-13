import test from 'node:test';

test('registration claim migration executes, reruns, serializes accounts, and records consent', async () => {
  await import('../scripts/verify-registration-integrity.mjs');
});
