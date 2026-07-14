import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260718_server_media_deletion_queue.sql';
const hardeningMigrationPath = 'supabase/migrations/20260719_harden_media_deletion_enqueue.sql';

test('server media retention queues expired references and keeps service operations private', async () => {
  const [migration, hardeningMigration, edgeFunction, workflow, ci, mediaStorage] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(hardeningMigrationPath, 'utf8'),
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

  assert.match(edgeFunction, /MEDIA_RETENTION_CRON_SECRET/);
  assert.match(edgeFunction, /runMediaRetentionCycle/);
  assert.match(edgeFunction, /admin\.storage\.from\(item\.bucket\)\.remove/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /MEDIA_RETENTION_CRON_SECRET/);
  assert.match(mediaStorage, /supabase\.rpc\('enqueue_memory_media_deletion'/);
  assert.match(mediaStorage, /Could not queue server-side media deletion/);
  assert.match(ci, /mobile-webkit:/);
  assert.match(ci, /playwright install --with-deps webkit/);
  assert.match(ci, /npm run test:e2e/);
});
