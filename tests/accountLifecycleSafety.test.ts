import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const deleteAccount = readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
const register = readFileSync('supabase/functions/register-with-invite/index.ts', 'utf8');
const registrationMigration = readFileSync('supabase/migrations/20260715_registration_integrity.sql', 'utf8');
const lifecycleMigration = readFileSync('supabase/migrations/20260716_account_lifecycle_hardening.sql', 'utf8');
const deploymentDocs = readFileSync('README.md', 'utf8');
const edgeConfig = readFileSync('supabase/config.toml', 'utf8');

test('account deletion authenticates the session and re-verifies the current password', () => {
  assert.match(deleteAccount, /admin\.auth\.getUser\(token\)/);
  assert.match(deleteAccount, /signInWithPassword\(\{[\s\S]*email: user\.email,[\s\S]*password/);
  assert.match(deleteAccount, /verified\.user\?\.id !== user\.id/);
  assert.match(deleteAccount, /admin\.auth\.admin\.signOut\(token, 'global'\)/);
  assert.doesNotMatch(deleteAccount, /console\.(?:log|warn|error)\([^\n]*password/i);
});

test('account deletion scans media before and repeatedly after Auth deletion', () => {
  const firstRemove = deleteAccount.indexOf('removedMediaCount = await removeUserMedia(admin.storage, user.id)');
  const authDelete = deleteAccount.indexOf('admin.auth.admin.deleteUser(user.id, false)');
  const finalRemove = deleteAccount.indexOf('postAuthRemovedMediaCount += await removeUserMedia(admin.storage, user.id)');
  assert.ok(firstRemove >= 0 && authDelete > firstRemove && finalRemove > authDelete);
  assert.match(deleteAccount, /POST_AUTH_CLEANUP_DELAYS_MS = \[250, 750, 1500\]/);
  assert.match(deleteAccount, /account_delete_post_auth_storage_failed/);
  assert.match(lifecycleMigration, /exists \([\s\S]*from public\.profiles[\s\S]*profiles\.id = auth\.uid\(\)/);
});

test('registration serializes each account before touching Auth', () => {
  const claim = register.indexOf("admin.rpc('claim_memory_registration'");
  const authLookup = register.indexOf('authUser = await findAuthUserByEmail(email)');
  const authCreate = register.indexOf('admin.auth.admin.createUser');
  assert.ok(claim >= 0 && authLookup > claim && authCreate > claim);
  assert.match(register, /registration_in_progress/);
  assert.match(register, /bind_memory_registration_claim/);
  assert.match(register, /initialize_claimed_memory_account/);
  assert.match(registrationMigration, /account_id text primary key/);
  assert.match(registrationMigration, /for update/);
});

test('an incomplete Auth user is verified with its original password and never taken over by admin reset', () => {
  assert.match(register, /verifyExistingAuthPassword/);
  assert.match(register, /passwordVerifier\.auth\.signInWithPassword\(\{ email, password \}\)/);
  assert.doesNotMatch(register, /updateUserById\([^)]*,\s*\{[\s\S]{0,300}?password,/);
  assert.match(register, /createdByCurrentRequest = true/);
});

test('registration rollback requires the exact server-owned nonce and rechecks completed rows', () => {
  assert.match(register, /app_metadata:[\s\S]*registration_pending: true,[\s\S]*registration_nonce: requestNonce/);
  assert.match(register, /metadata\.registration_pending !== true \|\| metadata\.registration_nonce !== requestNonce/);
  assert.match(register, /getInitializationStatus\(userId\)/);
  assert.match(register, /memory_privacy_consents/);
  assert.match(register, /if \(initialization\.complete\) return 'completed'/);
  assert.match(register, /if \(createdByCurrentRequest\)/);
  assert.match(register, /registration_pending: false/);
  assert.doesNotMatch(register, /deleteUser\(userId\)\.catch\(\(\) => \{\}\)/);
});

test('registration verifies password confirmation and persists a versioned privacy consent', () => {
  assert.match(register, /password !== passwordConfirmation/);
  assert.match(register, /privacyAccepted/);
  assert.match(register, /PRIVACY_NOTICE_VERSION = '2026-07-13'/);
  assert.match(registrationMigration, /create table if not exists public\.memory_privacy_consents/);
  assert.match(registrationMigration, /consented_at timestamptz not null default now\(\)/);
  assert.match(registrationMigration, /p_privacy_version/);
});

test('delete-account is included in Edge config and the official production integration', () => {
  assert.match(edgeConfig, /\[functions\.delete-account\][\s\S]*verify_jwt = false/);
  assert.match(deploymentDocs, /official Supabase GitHub Integration/);
  assert.match(deploymentDocs, /`main` is the production branch/);
  assert.equal(existsSync('.github/workflows/deploy-supabase.yml'), false);
});
