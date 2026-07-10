import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');

test('cloud MCP accepts native client origins while retaining bearer authentication', () => {
  assert.doesNotMatch(source, /isOriginAllowed\(request\)/);
  assert.match(source, /'Access-Control-Allow-Origin': '\*'/);
  assert.match(source, /authenticateMcpRequest\(request, config, localCorsHeaders\)/);
});

test('cloud MCP exposes JSON Streamable HTTP instead of a broken legacy SSE endpoint', () => {
  assert.doesNotMatch(source, /event: endpoint/);
  assert.doesNotMatch(source, /data: \/mcp/);
  assert.match(source, /request\.method === 'GET'/);
  assert.match(source, /405/);
  assert.match(source, /Allow: 'POST, OPTIONS'/);
});

test('cloud MCP does not call catch on the Supabase query builder', () => {
  assert.doesNotMatch(source, /\.eq\('id', data\.id\)\s*\.catch\(/);
  assert.match(source, /error: usageUpdateError/);
  assert.match(source, /MCP authentication failed unexpectedly/);
});
