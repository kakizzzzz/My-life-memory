import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deleteAccount = readFileSync('supabase/functions/delete-account/index.ts', 'utf8');
const register = readFileSync('supabase/functions/register-with-invite/index.ts', 'utf8');
const deployment = readFileSync('.github/workflows/deploy-supabase.yml', 'utf8');
const edgeConfig = readFileSync('supabase/config.toml', 'utf8');

test('account deletion authenticates the session and re-verifies the current password', () => {
  assert.match(deleteAccount, /admin\.auth\.getUser\(token\)/);
  assert.match(deleteAccount, /signInWithPassword\(\{[\s\S]*email: user\.email,[\s\S]*password/);
  assert.match(deleteAccount, /verified\.user\?\.id !== user\.id/);
  assert.match(deleteAccount, /admin\.auth\.admin\.signOut\(token, 'global'\)/);
  assert.doesNotMatch(deleteAccount, /console\.(?:log|warn|error)\([^\n]*password/i);
});

test('account deletion empties only the authenticated user media folder before Auth deletion', () => {
  const removeCall = deleteAccount.indexOf('removeUserMedia(admin.storage, user.id)');
  const authDelete = deleteAccount.indexOf('admin.auth.admin.deleteUser(user.id, false)');
  assert.ok(removeCall >= 0 && authDelete > removeCall);
  assert.match(deleteAccount, /listStorageFiles\(storage, userId\)/);
  assert.match(deleteAccount, /if \(remaining\.length > 0\)/);
  assert.match(deleteAccount, /code: 'storage_cleanup_failed'/);
});

test('registration rollback is retried and verified, including legacy orphan Auth users', () => {
  assert.match(register, /const rollbackAuthUser/);
  assert.match(register, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(register, /getUserById\(userId\)/);
  assert.match(register, /const isConfirmedMissing/);
  assert.match(register, /registration_pending: true/);
  assert.match(register, /\.eq\('id', authUser\.id\)/);
  assert.match(register, /if \(authProfile\)/);
  assert.doesNotMatch(register, /authUser\.user_metadata\?\.registration_pending !== true/);
  assert.match(register, /registration_pending: false/);
  assert.doesNotMatch(register, /deleteUser\(userId\)\.catch\(\(\) => \{\}\)/);
});

test('delete-account is included in Edge config and production deployment', () => {
  assert.match(edgeConfig, /\[functions\.delete-account\][\s\S]*verify_jwt = false/);
  assert.match(deployment, /supabase functions deploy delete-account/);
});
