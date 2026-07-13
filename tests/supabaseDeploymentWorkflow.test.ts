import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/deploy-supabase.yml', import.meta.url);
const deployScriptPath = new URL('../scripts/deploy-supabase-migrations.mjs', import.meta.url);

test('Supabase deployment does not store or require the database password', async () => {
  const workflow = await readFile(workflowPath, 'utf8');

  assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD/);
  assert.doesNotMatch(workflow, /supabase db push|supabase link/);
  assert.match(workflow, /npm run deploy:supabase-migrations/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /SUPABASE_PROJECT_REF/);
});

test('migration deployer applies only missing versions and registers after success', async () => {
  const script = await readFile(deployScriptPath, 'utf8');

  assert.match(script, /supabase_migrations\.schema_migrations/);
  assert.match(script, /pendingMigrations/);
  assert.match(script, /await runQuery\(\{ accessToken, projectRef, query: sql \}\)/);
  assert.match(script, /on conflict\(version\) do nothing/);
  assert.doesNotMatch(script, /console\.(?:log|error)\([^\n]*accessToken/);
});
