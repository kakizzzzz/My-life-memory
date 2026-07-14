import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readme = readFileSync('README.md', 'utf8');
const verifyBackend = readFileSync('supabase/verify-cloud-backend.sql', 'utf8');

const setupSection = readme.slice(
  readme.indexOf('## Supabase Setup'),
  readme.indexOf('### Normalized v2 production checklist'),
);
const productionChecklist = readme.slice(
  readme.indexOf('### Normalized v2 production checklist'),
  readme.indexOf('Storage paths are user scoped:'),
);

test('deployment documentation includes the latest hardening migration', () => {
  assert.match(setupSection, /20260719_harden_media_deletion_enqueue\.sql/);
  assert.match(productionChecklist, /20260719_harden_media_deletion_enqueue\.sql/);
  assert.match(setupSection, /20260720_schedule_media_retention_with_supabase_cron\.sql/);
  assert.match(productionChecklist, /20260720_schedule_media_retention_with_supabase_cron\.sql/);
});

test('production checklist includes media retention and mobile e2e verification', () => {
  assert.match(productionChecklist, /npm run test:e2e/);
  assert.match(productionChecklist, /`media-retention`/);
  assert.match(productionChecklist, /my-life-memory-media-retention-daily/);
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
