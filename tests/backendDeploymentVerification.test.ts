import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readme = readFileSync('README.md', 'utf8');
const backendSetup = readFileSync('docs/backend-setup.md', 'utf8');
const verifyBackend = readFileSync('supabase/verify-cloud-backend.sql', 'utf8');

test('deployment documentation includes the latest hardening migration', () => {
  assert.match(readme, /docs\/backend-setup\.md/);
  assert.match(backendSetup, /20260719_harden_media_deletion_enqueue\.sql/);
  assert.match(backendSetup, /20260720_schedule_media_retention_with_supabase_cron\.sql/);
  assert.match(backendSetup, /20260721_require_media_retention_prerequisites\.sql/);
  assert.match(backendSetup, /20260722_allow_no_referrer_note_images\.sql/);
});

test('backend verifier checks the rich-image database sanitizer compatibility', () => {
  assert.match(verifyBackend, /accepts_no_referrer_images/);
  assert.match(verifyBackend, /rejects_other_referrer_policies/);
  assert.match(verifyBackend, /referrerpolicy="no-referrer"/);
  assert.match(verifyBackend, /referrerpolicy="origin"/);
});

test('deployment order configures the Function and Vault before strict Cron scheduling', () => {
  const deployIndex = backendSetup.indexOf('### 3. Deploy Edge Functions');
  const vaultIndex = backendSetup.indexOf('Generate one random retention secret');
  const strictMigrationIndex = backendSetup.indexOf(
    '20260721_require_media_retention_prerequisites.sql',
    vaultIndex,
  );
  const bridgeCheckIndex = backendSetup.indexOf(
    'select public.invoke_memory_media_retention();',
    strictMigrationIndex,
  );

  assert.ok(deployIndex >= 0);
  assert.ok(vaultIndex > deployIndex);
  assert.ok(strictMigrationIndex > vaultIndex);
  assert.ok(bridgeCheckIndex > strictMigrationIndex);
  assert.match(backendSetup, /require HTTP `200`/);
});

test('production checklist includes media retention and mobile e2e verification', () => {
  assert.match(backendSetup, /npm run test:e2e/);
  assert.match(backendSetup, /`media-retention`/);
  assert.match(backendSetup, /my-life-memory-media-retention-daily/);
});

test('backend verifier lists every required production table', () => {
  for (const table of [
    'profiles',
    'app_states',
    'mcp_tokens',
    'edge_rate_limits',
    'memory_settings',
    'memory_stars',
    'memory_notes',
    'memory_tracks',
    'memory_entity_history',
    'memory_registration_claims',
    'memory_privacy_consents',
    'memory_media_deletion_queue',
  ]) {
    assert.match(verifyBackend, new RegExp(`\\('${table}'\\)`));
  }
  assert.match(verifyBackend, /with required_tables\(table_name\)/);
  assert.match(verifyBackend, /to_regclass\(format\('public\.%I', table_name\)\)/);
});

test('backend verifier covers the complete atomic registration RPC boundary', () => {
  for (const rpc of [
    'claim_memory_registration',
    'bind_memory_registration_claim',
    'release_memory_registration_claim',
    'initialize_claimed_memory_account',
    'initialize_normalized_memory_account',
  ]) {
    assert.match(verifyBackend, new RegExp(rpc));
  }
  assert.match(verifyBackend, /has_function_privilege\('service_role'/);
  assert.match(verifyBackend, /has_function_privilege\('anon'/);
  assert.match(verifyBackend, /has_function_privilege\('authenticated'/);
});

test('backend verifier keeps missing RPCs visible in its output', () => {
  assert.match(verifyBackend, /with required_rpcs\(routine_name\)/);
  assert.match(verifyBackend, /left join information_schema\.routines actual/);
  assert.match(verifyBackend, /'MISSING'/);
});

test('backend verifier covers Supabase Cron, Vault names, and the private bridge', () => {
  assert.match(verifyBackend, /\('pg_cron'\), \('pg_net'\)/);
  assert.match(verifyBackend, /my_life_memory_project_url/);
  assert.match(verifyBackend, /my_life_memory_media_retention_secret/);
  assert.match(verifyBackend, /my-life-memory-expired-trash-daily/);
  assert.match(verifyBackend, /my-life-memory-media-retention-daily/);
  assert.match(verifyBackend, /invoke_memory_media_retention/);
  assert.doesNotMatch(verifyBackend, /decrypted_secret/);
});
