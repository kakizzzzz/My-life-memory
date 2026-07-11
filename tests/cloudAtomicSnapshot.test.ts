import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260712_atomic_app_snapshot.sql', 'utf8');
const backend = readFileSync('src/lib/cloudBackend.ts', 'utf8');
const syncHook = readFileSync('src/hooks/useCloudAuthSync.ts', 'utf8');

test('atomic snapshot migration revision-checks state before updating profile', () => {
  const stateUpdate = migration.indexOf('update public.app_states');
  const revisionCheck = migration.indexOf('app_states.revision = greatest');
  const profileUpdate = migration.indexOf('update public.profiles');
  assert.ok(stateUpdate >= 0);
  assert.ok(revisionCheck > stateUpdate);
  assert.ok(profileUpdate > revisionCheck);
  assert.match(migration, /grant execute on function public\.save_app_snapshot[\s\S]*to authenticated/);
  assert.match(migration, /revoke all on function public\.save_app_snapshot[\s\S]*from public, anon/);
  assert.match(migration, /create or replace function public\.load_app_snapshot\(\)/);
  assert.match(migration, /grant execute on function public\.load_app_snapshot\(\) to authenticated/);
});

test('cloud account loading reads app state and revision from the same row', () => {
  assert.match(backend, /\.rpc\('load_app_snapshot'\)/);
  assert.match(backend, /\.select\('state,revision'\)/);
  assert.doesNotMatch(syncHook, /Promise\.all\(\[\s*loadCloudAccountData\(session\.user\),\s*readCloudStateRevision/);
});

test('normal cloud saves use the atomic snapshot path', () => {
  assert.match(syncHook, /saveCloudSnapshotVersioned\(/);
  assert.doesNotMatch(syncHook, /await saveCloudProfile\(pendingSnapshot\.profile\)/);
});
