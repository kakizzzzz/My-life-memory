import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMcpAccessToken } from '../supabase/functions/_shared/security';

const token = `mlm_${'a'.repeat(64)}`;

test('accepts standard Bearer and raw MCP access tokens', () => {
  assert.equal(parseMcpAccessToken(`Bearer ${token}`), token);
  assert.equal(parseMcpAccessToken(`  Bearer ${token}  `), token);
  assert.equal(parseMcpAccessToken(token), token);
  assert.equal(parseMcpAccessToken(`  ${token}\n`), token);
});

test('rejects malformed or incomplete MCP access tokens', () => {
  assert.equal(parseMcpAccessToken(''), '');
  assert.equal(parseMcpAccessToken('Bearer'), '');
  assert.equal(parseMcpAccessToken('Bearer Bearer mlm_invalid'), '');
  assert.equal(parseMcpAccessToken(`Bearer ${token.slice(0, -1)}`), '');
  assert.equal(parseMcpAccessToken('Bearer arbitrary-secret'), '');
});
