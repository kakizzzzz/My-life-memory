import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260718_server_media_deletion_queue.sql';
const hardeningMigrationPath = 'supabase/migrations/20260719_harden_media_deletion_enqueue.sql';
const schedulingMigrationPath = 'supabase/migrations/20260720_schedule_media_retention_with_supabase_cron.sql';
const prerequisiteMigrationPath = 'supabase/migrations/20260721_require_media_retention_prerequisites.sql';

test('server media retention queues expired references and keeps service operations private', async () => {
  const [
    migration,
    hardeningMigration,
    schedulingMigration,
    prerequisiteMigration,
    edgeFunction,
    workflow,
    ci,
    mediaStorage,
  ] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(hardeningMigrationPath, 'utf8'),
    readFile(schedulingMigrationPath, 'utf8'),
    readFile(prerequisiteMigrationPath, 'utf8'),
    readFile('supabase/functions/media-retention/index.ts', 'utf8'),
    readFile('.github/workflows/media-retention.yml', 'utf8'),
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('src/lib/mediaStorage.ts', 'utf8'),
  ]);

  assert.match(migration, /create table if not exists public\.memory_media_deletion_queue/i);
  assert.match(migration, /before delete on public\.memory_notes/i);
  assert.match(migration, /before delete on public\.memory_entity_history/i);
  assert.match(migration, /memory_media_path_is_protected/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /grant execute on function public\.enqueue_memory_media_deletion[\s\S]+to authenticated/i);
  assert.match(migration, /grant execute on function public\.claim_due_memory_media_deletions[\s\S]+to service_role/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.app_states/i);

  assert.match(hardeningMigration,
    /lock table public\.memory_media_deletion_queue in share row exclusive mode/i);
  assert.match(hardeningMigration,
    /where not_before > now\(\) \+ interval '7 days'/i);
  assert.match(hardeningMigration,
    /char_length\(p_path\) not between 1 and 1024/i);
  assert.match(hardeningMigration,
    /p_path !~ '\^\[A-Za-z0-9_\.\/-\]\+\$'/i);
  assert.match(hardeningMigration,
    /p_path ~ '\(\^\|\/\)\[\.\]\{1,2\}\(\/\|\$\)'/i);
  assert.match(hardeningMigration, /strpos\(p_path, '\/\/'\) > 0/i);
  assert.match(hardeningMigration,
    /from storage\.objects object[\s\S]+object\.bucket_id = 'life-media'[\s\S]+object\.name = p_path/i);
  assert.match(hardeningMigration,
    /set not_before = least\([\s\S]+memory_media_deletion_queue\.not_before[\s\S]+excluded\.not_before/i);
  assert.match(hardeningMigration,
    /grant execute on function public\.enqueue_memory_media_deletion[\s\S]+to authenticated/i);
  assert.doesNotMatch(hardeningMigration,
    /grant execute on function public\.memory_enqueue_media_paths_for_user[\s\S]+to authenticated/i);
  assert.doesNotMatch(hardeningMigration, /delete\s+from\s+public\.app_states/i);

  assert.match(schedulingMigration, /create extension if not exists pg_net/i);
  assert.match(schedulingMigration, /create extension if not exists pg_cron/i);
  assert.match(schedulingMigration, /vault\.decrypted_secrets/i);
  assert.match(schedulingMigration, /my_life_memory_project_url/i);
  assert.match(schedulingMigration, /my_life_memory_media_retention_secret/i);
  assert.match(schedulingMigration, /net\.http_post/i);
  assert.match(schedulingMigration, /Authorization', 'Bearer ' \|\| v_retention_secret/i);
  assert.match(schedulingMigration, /my-life-memory-media-retention-daily/i);
  assert.match(schedulingMigration, /select public\.invoke_memory_media_retention\(\);/i);
  assert.match(schedulingMigration,
    /revoke all on function public\.invoke_memory_media_retention\(\)[\s\S]+from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(schedulingMigration, /sbp_|service_role_key|sb_secret_/i);

  assert.match(prerequisiteMigration, /v_project_count <> 1/i);
  assert.match(prerequisiteMigration, /v_retention_count <> 1/i);
  assert.match(prerequisiteMigration, /Vault project URL must exist exactly once/i);
  assert.match(prerequisiteMigration, /Vault media retention secret must exist exactly once/i);
  assert.match(prerequisiteMigration, /\^https:\/\/\[a-z0-9-\]\+\[\.\]supabase\[\.\]co\$/i);
  assert.match(prerequisiteMigration, /char_length\(v_retention_secret\) < 32/i);
  assert.match(prerequisiteMigration, /raise exception 'pg_cron is unavailable'/i);
  assert.match(prerequisiteMigration, /raise exception 'pg_net is unavailable'/i);
  assert.match(prerequisiteMigration, /select cron\.unschedule\(\$1\)/i);
  assert.match(prerequisiteMigration, /select cron\.schedule\(/i);
  assert.ok(
    prerequisiteMigration.indexOf('v_project_count <> 1')
      < prerequisiteMigration.lastIndexOf('select cron.schedule('),
  );
  assert.match(prerequisiteMigration,
    /revoke all on function public\.invoke_memory_media_retention\(\)[\s\S]+from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(prerequisiteMigration, /sbp_|service_role_key|sb_secret_/i);

  assert.match(edgeFunction, /MEDIA_RETENTION_CRON_SECRET/);
  assert.match(edgeFunction, /runMediaRetentionCycle/);
  assert.match(edgeFunction, /admin\.storage\.from\(item\.bucket\)\.remove/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /name: Manual Media Retention/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /MEDIA_RETENTION_CRON_SECRET/);
  assert.match(mediaStorage, /client\.rpc\('enqueue_memory_media_deletion'/);
  assert.match(mediaStorage, /createSessionScopedSupabaseClient\(options\.accountScope\.accessToken\)/);
  assert.match(mediaStorage, /Could not queue server-side media deletion/);
  assert.match(ci, /mobile-webkit:/);
  assert.match(ci, /playwright install --with-deps webkit/);
  assert.match(ci, /npm run test:e2e/);
});
