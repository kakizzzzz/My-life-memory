import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
const localSource = readFileSync(new URL('../mcp/memory-server.mjs', import.meta.url), 'utf8');
const contractSource = readFileSync(new URL('../supabase/functions/_shared/mcp-memory-contract.mjs', import.meta.url), 'utf8');
const publicSchemaSource = readFileSync(new URL('../supabase/functions/_shared/mcp-memory-public-schema.mjs', import.meta.url), 'utf8');

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
  assert.match(contractSource, /MCP_SERVER_VERSION = '0\.7\.0'/);
  assert.match(contractSource, /Compose explicit public geography, exact dates, user-relative anchors/);
  assert.match(contractSource, /repeat directive\.exactText exactly and add nothing/i);
  assert.match(contractSource, /Neutral clarification options are not evidence/);
  assert.match(contractSource, /Never choose an option on the user’s behalf/);
  assert.match(contractSource, /Host-model semantic judgments cannot promote candidates into evidence/);
  assert.match(contractSource, /contains no backend model, embeddings service, vector database, or paid inference API/);
});

test('both transports expose structured evidence-firewall output and user confirmation input', () => {
  assert.match(source, /outputSchema: MEMORY_RESEARCH_OUTPUT_SCHEMA/);
  assert.match(source, /structuredContent: payload/);
  assert.match(source, /referenceConfirmation: referenceConfirmationSchema/);
  assert.match(source, /semanticHints: semanticHintsSchema/);
  assert.match(localSource, /outputSchema: memoryResearchOutputSchema/);
  assert.match(localSource, /structuredContent: value/);
  assert.match(localSource, /referenceConfirmation/);
  assert.match(localSource, /semanticHints/);
  assert.match(publicSchemaSource, /oneOf: \[supported, ambiguous, notFound, candidateReview\]/);
  assert.match(publicSchemaSource, /additionalProperties: false/);
  assert.doesNotMatch(contractSource, /OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|QWEN_API_KEY/);
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
