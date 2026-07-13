import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync('supabase/migrations/20260713_normalized_memory_storage_v2.sql', 'utf8');
const verify = readFileSync('supabase/verify-normalized-memory.sql', 'utf8');
const recovery = readFileSync('supabase/recover-normalized-memory-for-user.sql', 'utf8');
const serviceWorker = readFileSync('public/sw.js', 'utf8');
const mediaHook = readFileSync('src/hooks/useCloudMediaMaintenance.ts', 'utf8');

test('star deletion soft-deletes child notes and records their old values', () => {
  const branch = sql.slice(sql.indexOf("elsif v_type = 'star_soft_delete'"), sql.indexOf("elsif v_type = 'note_upsert'"));
  assert.match(branch, /insert into public\.memory_entity_history/);
  assert.match(branch, /update public\.memory_notes set deleted_at = now\(\)/);
  assert.match(branch, /update public\.memory_stars set deleted_at = now\(\)/);
  assert.doesNotMatch(branch, /delete from public\.memory_(?:stars|notes)/);
});

test('migration preserves old archives and marks verification only after all comparisons', () => {
  assert.match(sql, /create temporary table memory_v2_migration_users/);
  assert.match(sql, /where settings\.migration_verified_at is null/);
  assert.match(sql, /raise exception 'Normalized memory verification failed/);
  assert.match(sql, /migration_verified_at = now\(\)/);
  assert.match(sql, /profile row is missing/);
  assert.doesNotMatch(sql, /truncate public\.app_states|delete from public\.app_states/i);
  assert.match(verify, /migration_verified/);
});

test('migration locks legacy sources before capturing the normalized snapshot', () => {
  const transactionStart = sql.indexOf('begin;');
  const appStatesLock = sql.indexOf('lock table public.app_states in share row exclusive mode;');
  const profilesLock = sql.indexOf('lock table public.profiles in share row exclusive mode;');
  const migrationSnapshot = sql.indexOf('create temporary table memory_v2_migration_users');

  assert.ok(transactionStart >= 0, 'migration transaction must start explicitly');
  assert.ok(appStatesLock > transactionStart, 'app_states must be locked after the transaction starts');
  assert.ok(profilesLock > transactionStart, 'profiles must be locked after the transaction starts');
  assert.ok(appStatesLock < migrationSnapshot, 'app_states must be locked before the archive snapshot');
  assert.ok(profilesLock < migrationSnapshot, 'profiles must be locked before the archive snapshot');
});

test('RLS and RPC scope every ordinary request to auth.uid', () => {
  for (const table of ['memory_settings', 'memory_stars', 'memory_notes', 'memory_tracks', 'memory_entity_history']) {
    assert.match(sql, new RegExp(`using \\(auth\\.uid\\(\\) = user_id\\)[\\s\\S]*${table}|${table}[\\s\\S]*using \\(auth\\.uid\\(\\) = user_id\\)`));
  }
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /on public\.profiles for select to authenticated[\s\S]*using \(auth\.uid\(\) = id\)/);
  assert.match(sql, /apply_memory_mutations\(\s*p_expected_revision bigint,\s*p_mutations jsonb\s*\)/);
});

test('normalized mutations reject sensitive authentication metadata', () => {
  assert.match(sql, /memory_json_has_sensitive_keys/);
  assert.match(sql, /Mutation payload contains sensitive authentication fields/);
  assert.match(sql, /memory_strip_sensitive_json/);
});

test('media cleanup protects active, soft-deleted, and historical normalized references', () => {
  assert.match(sql, /list_protected_memory_media_paths/);
  assert.match(sql, /from public\.memory_notes note/);
  assert.match(sql, /from public\.memory_entity_history history/);
  assert.match(mediaHook, /loadProtectedMemoryMediaPaths/);
  assert.match(mediaHook, /readPendingMemoryMediaPaths/);
});

test('same-account recovery cannot target another source account', () => {
  assert.match(recovery, /where user_id = target_user_id/);
  assert.doesNotMatch(recovery, /source_user_id|destination_user_id|target_account/);
  assert.match(recovery, /No legacy archive exists for this user/);
});

test('service worker cache is bumped for the normalized client', () => {
  assert.match(serviceWorker, /my-life-memory-shell-v2-registration-integrity/);
  assert.doesNotMatch(serviceWorker, /my-life-memory-shell-v1/);
});
