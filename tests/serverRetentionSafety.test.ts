import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = 'supabase/migrations/20260717_server_retention_and_archive_redaction.sql';

test('server retention is scheduled daily and remains owner-only', async () => {
  const sql = await readFile(migrationPath, 'utf8');

  assert.match(sql, /purge_expired_memory_trash_all_users\(\)/);
  assert.match(sql, /my-life-memory-expired-trash-daily/);
  assert.match(sql, /23 3 \* \* \*/);
  assert.match(
    sql,
    /revoke all on function public\.purge_expired_memory_trash_all_users\(\)\s+from public, anon, authenticated, service_role/i,
  );
  assert.doesNotMatch(sql, /delete\s+from\s+public\.app_states/i);
  assert.match(sql, /memory_strip_sensitive_json\(archive\.state\)/);
});
