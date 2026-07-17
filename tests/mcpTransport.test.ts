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

test('cloud MCP advertises the geographic and temporal research protocol', () => {
  assert.match(source, /name: 'research_memory_context'/);
  assert.match(source, /country, city, town, village/);
  assert.match(source, /place argument/);
  assert.match(source, /instructions: MCP_MEMORY_INSTRUCTIONS/);
  assert.match(source, /version: '0\.3\.0'/);
});

test('cloud MCP upgrades an empty literal search to contextual research', () => {
  assert.match(source, /toolName === 'search_memories'/);
  assert.match(source, /shouldUseContextualSearchFallback\(payload, args\)/);
  assert.match(source, /'research_memory_context'/);
  assert.match(source, /mergeContextualSearchFallback\(payload, contextual\)/);
});

test('cloud MCP exposes bounded private image blocks for relevant notes', () => {
  assert.match(source, /name: 'get_memory_images'/);
  assert.match(source, /maxItems: 10/);
  assert.match(source, /maximum: 6/);
  assert.match(source, /buildMcpImageContent/);
  assert.match(source, /get_note_media/);
});
