import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260714_memory_trash_retention.sql', 'utf8');
const oldMigration = readFileSync('supabase/migrations/20260713_normalized_memory_storage_v2.sql', 'utf8');
const maintenanceHook = readFileSync('src/hooks/useCloudMediaMaintenance.ts', 'utf8');
const maintenancePersistence = readFileSync('src/lib/mediaMaintenancePersistence.ts', 'utf8');
const mediaStorage = readFileSync('src/lib/mediaStorage.ts', 'utf8');
const fixPermissions = readFileSync('supabase/fix-permissions.sql', 'utf8');
const verifyBackend = readFileSync('supabase/verify-cloud-backend.sql', 'utf8');

test('trash retention is a separate migration and never modifies app_states', () => {
  assert.match(migration, /create or replace function public\.purge_expired_memory_trash\(\)/);
  assert.doesNotMatch(migration, /(?:update|delete from|truncate)\s+public\.app_states/i);
  assert.doesNotMatch(oldMigration, /purge_expired_memory_trash/);
});

test('purge is user-scoped, serialized, seven-day limited, and parent safe', () => {
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /now\(\) - interval '7 days'/);
  assert.match(migration, /note\.user_id = v_user_id/);
  assert.match(migration, /track\.user_id = v_user_id/);
  assert.match(migration, /star\.user_id = v_user_id/);
  assert.match(migration, /not exists[\s\S]*from public\.memory_notes child/);
  assert.match(migration, /grant execute on function public\.purge_expired_memory_trash\(\) to authenticated/);
});

test('history expires after seven days while retaining the twenty-version cap', () => {
  assert.match(migration, /history\.changed_at < now\(\) - interval '7 days'/);
  assert.match(migration, /partition by item\.entity_type, item\.entity_key/);
  assert.match(migration, /where ranked\.position > 20/);
});

test('client purges at most daily only after sync, before protected-path scanning', () => {
  const runMaintenance = maintenanceHook.slice(maintenanceHook.indexOf('const runMaintenance'));
  const phaseCheck = runMaintenance.indexOf("getCloudSyncStatus().phase === 'synced'");
  const claim = runMaintenance.indexOf('claimDailyMemoryTrashPurge');
  const purge = runMaintenance.indexOf('await purgeExpiredMemoryTrash(scopedClient)');
  const protectedPaths = runMaintenance.indexOf('await getProtectedStoredMedia(accountScope)');
  assert.ok(phaseCheck >= 0 && phaseCheck < claim);
  assert.ok(claim < purge && purge < protectedPaths);
  assert.match(maintenancePersistence, /my-life-memory-trash-purge-v1:/);
  assert.match(maintenancePersistence, /now - previousAttempt < MEDIA_SCAN_INTERVAL_MS/);
  assert.match(maintenanceHook, /createSessionScopedSupabaseClient\(accountScope\.accessToken\)/);
});

test('deferred and orphan media grace periods are both seven days', () => {
  assert.match(mediaStorage, /DEFERRED_MEDIA_DELETE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(mediaStorage, /ORPHAN_MEDIA_GRACE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
});

test('permission repair and backend verification include the purge RPC', () => {
  assert.match(fixPermissions, /grant execute on function public\.purge_expired_memory_trash\(\) to authenticated/);
  assert.match(verifyBackend, /'purge_expired_memory_trash'/);
});
