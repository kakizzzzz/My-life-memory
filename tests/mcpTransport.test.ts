import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
const localSource = readFileSync(new URL('../mcp/memory-server.mjs', import.meta.url), 'utf8');
const contractSource = readFileSync(new URL('../supabase/functions/_shared/mcp-memory-contract.mjs', import.meta.url), 'utf8');
const semanticReviewSource = readFileSync(new URL('../supabase/functions/_shared/memory-semantic-review.ts', import.meta.url), 'utf8');

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

test('cloud MCP advertises the shared compositional and temporal research protocol', () => {
  assert.match(source, /name: 'research_memory_context'/);
  assert.match(source, /RESEARCH_MEMORY_TOOL_DESCRIPTION/);
  assert.match(source, /buildMcpMemoryInstructions\(temporalPayload\?\.temporalContext\)/);
  assert.match(source, /version: MCP_SERVER_VERSION/);
  assert.match(contractSource, /MCP_SERVER_VERSION = '0\.5\.0'/);
  assert.match(contractSource, /Compose explicit public geography, exact dates, user-relative anchors/);
  assert.match(contractSource, /Candidate notes are unverified, coordinate-free review aids/);
  assert.match(contractSource, /Never reverse-geocode returned coordinates/);
  assert.match(contractSource, /answerBoundary is mandatory, not advisory/);
  assert.match(contractSource, /My Life Memory does not contain, call, or pay for a model service/);
  assert.match(contractSource, /storage mutation timestamp, never as proof/);
});

test('semantic fallback is an exact-quote protocol and never calls a model service', () => {
  assert.match(source, /semanticReview: semanticReviewSchema/);
  assert.match(localSource, /semanticReview,/);
  assert.match(semanticReviewSource, /usesExternalModelService: false/);
  assert.match(semanticReviewSource, /exact quote/i);
  assert.doesNotMatch(semanticReviewSource, /fetch\s*\(/);
  assert.doesNotMatch(semanticReviewSource, /OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|QWEN_API_KEY/);
});

test('cloud and local MCP transports expose the same exact nine read-only tools', () => {
  const cloudListStart = source.indexOf('const readTools = [');
  const cloudListEnd = source.indexOf('\n];', cloudListStart);
  const cloudToolsSource = source.slice(cloudListStart, cloudListEnd);
  const cloudToolNames = [...cloudToolsSource.matchAll(/name: '([^']+)'/g)].map(match => match[1]);
  const localToolNames = [...localSource.matchAll(/server\.registerTool\('([^']+)'/g)].map(match => match[1]);

  assert.equal(cloudToolNames.length, 9);
  assert.equal(localToolNames.length, 9);
  assert.deepEqual(localToolNames, cloudToolNames);
  assert.equal([...cloudToolsSource.matchAll(/readOnlyHint: true/g)].length, 9);
  assert.equal([...localSource.matchAll(/readOnlyHint: true/g)].length, 9);
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
