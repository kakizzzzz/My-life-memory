import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260713_normalized_memory_storage_v2.sql', 'utf8');
const backend = readFileSync('src/lib/cloudBackend.ts', 'utf8');
const repository = readFileSync('src/lib/memoryRepository.ts', 'utf8');
const syncHook = readFileSync('src/hooks/useCloudAuthSync.ts', 'utf8');
const memoryApi = readFileSync('supabase/functions/memory-api/index.ts', 'utf8');
const normalizedShared = readFileSync('supabase/functions/_shared/normalized-memory.ts', 'utf8');
const mcp = readFileSync('supabase/functions/mcp/index.ts', 'utf8');
const register = readFileSync('supabase/functions/register-with-invite/index.ts', 'utf8');
const trackRecording = readFileSync('src/hooks/useTrackRecording.ts', 'utf8');

test('normalized migration creates isolated tables, RLS, history, and atomic mutations', () => {
  for (const table of ['memory_settings', 'memory_stars', 'memory_notes', 'memory_tracks', 'memory_entity_history']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /foreign key \(user_id, star_id\)[\s\S]*references public\.memory_stars\(user_id, id\)/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /v_next_revision := v_current_revision \+ 1/);
  assert.match(migration, /perform public\.record_memory_history/);
  assert.match(migration, /position > 20/);
});

test('migration keeps app_states as a read-only archive and rejects legacy snapshot writes', () => {
  assert.match(migration, /revoke all on public\.app_states from authenticated/);
  assert.match(migration, /drop policy if exists "Users can read own app state"/);
  assert.match(migration, /drop policy if exists "Users can update own app state"/);
  assert.match(migration, /legacy_snapshot_write_rejected/);
  assert.match(migration, /legacy_snapshot_read_rejected/);
  assert.doesNotMatch(memoryApi, /\.from\(['"]app_states['"]\)/);
  assert.doesNotMatch(mcp, /\.from\(['"]app_states['"]\)/);
  assert.doesNotMatch(syncHook, /saveCloudSnapshotVersioned|PendingCloudSnapshot/);
});

test('normal client reads and writes use normalized repositories and entity outbox', () => {
  assert.match(backend, /loadNormalizedMemoryAccountData/);
  assert.match(repository, /table: 'memory_stars'/);
  assert.match(repository, /table: 'memory_notes'/);
  assert.match(repository, /table: 'memory_tracks'/);
  assert.match(repository, /\.rpc\('apply_memory_mutations'/);
  assert.match(syncHook, /enqueueMemoryMutations/);
  assert.match(syncHook, /applyMemoryMutations\(pendingOutbox\.expectedRevision, pendingBatch\)/);
  assert.match(syncHook, /cloudUserIdRef\.current !== userId/);
  assert.match(syncHook, /baseStateAtSend/);
});

test('migration is idempotent and verifies counts, order, ids, and content before completion', () => {
  assert.match(migration, /on conflict \(user_id, id\) do nothing/);
  assert.match(migration, /on conflict \(user_id, star_id, id\) do nothing/);
  assert.match(migration, /starContentChecksum/);
  assert.match(migration, /noteContentChecksum/);
  assert.match(migration, /trackContentChecksum/);
  const verificationGuard = migration.indexOf("raise exception 'Normalized memory verification failed");
  const verifiedUpdate = migration.indexOf('migration_verified_at = now()');
  assert.ok(verificationGuard >= 0 && verifiedUpdate > verificationGuard);
  assert.doesNotMatch(migration, /delete from public\.app_states/i);
});

test('registration initializes normalized rows without creating a new app state snapshot', () => {
  assert.match(register, /initialize_normalized_memory_account/);
  assert.doesNotMatch(register, /\.from\(['"]app_states['"]\)/);
  assert.match(migration, /insert into public\.memory_settings/);
  assert.match(migration, /insert into public\.memory_stars/);
});

test('Memory API is entity based, uses route createdAt, and defers media deletion', () => {
  assert.match(memoryApi, /loadNormalizedMemoryRows/);
  assert.match(memoryApi, /track\.created_at_ms/);
  assert.doesNotMatch(memoryApi, /isInDateRange\(track\.time/);
  assert.match(memoryApi, /memoryLoadOptions\(action, body\)/);
  assert.match(normalizedShared, /trackCreatedFromMs/);
  assert.match(normalizedShared, /noteCreatedFromMs/);
  assert.match(memoryApi, /summarize_normalized_memory_range/);
  assert.match(migration, /create or replace function public\.summarize_normalized_memory_range/);
  assert.match(migration, /grant execute on function public\.summarize_normalized_memory_range[\s\S]*to service_role/);
  assert.match(memoryApi, /note_soft_delete/);
  assert.match(memoryApi, /star_soft_delete/);
  assert.match(memoryApi, /mediaDeletion: 'deferred'/);
  assert.doesNotMatch(memoryApi, /storage\.from\('life-media'\)\.remove/);
  assert.match(trackRecording, /routeCreatedAtRef/);
  assert.match(trackRecording, /createdAt,\s*updatedAt: savedAt/);
});
