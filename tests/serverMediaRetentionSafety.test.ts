import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260718_server_media_deletion_queue.sql';

test('server media retention queues expired references and keeps service operations private', async () => {
  const [migration, edgeFunction, workflow, ci, mediaStorage] = await Promise.all([
    readFile(migrationPath, 'utf8'),
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
