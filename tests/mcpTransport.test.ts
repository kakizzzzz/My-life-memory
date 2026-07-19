import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemoryMcpServer } from '../mcp/memory-server.mjs';
import {
  MCP_TOOL_MANIFEST,
  MCP_TOOL_NAMES,
} from '../supabase/functions/_shared/mcp-tool-manifest.mjs';
import {
  createMcpCorsHeaders,
  isJsonRpcInitialize,
  isJsonRpcNotification,
  isJsonRpcResponse,
  isMcpOriginAllowed,
  isSupportedMcpProtocolHeader,
  MCP_PROTOCOL_VERSION,
  negotiateMcpProtocolVersion,
} from '../supabase/functions/_shared/mcp-transport.ts';

const source = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
const memoryApiSource = readFileSync(new URL('../supabase/functions/memory-api/index.ts', import.meta.url), 'utf8');
const contractSource = readFileSync(new URL('../supabase/functions/_shared/mcp-memory-contract.mjs', import.meta.url), 'utf8');
const publicSchemaSource = readFileSync(new URL('../supabase/functions/_shared/mcp-memory-public-schema.mjs', import.meta.url), 'utf8');

const withoutSchemaDialect = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutSchemaDialect);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== '$schema')
      .map(([key, entry]) => [key, withoutSchemaDialect(entry)]),
  );
};

test('cloud MCP applies a concrete-origin allowlist without weakening bearer authentication', () => {
  assert.match(source, /isMcpOriginAllowed\(origin, configuredOrigins\)/);
  assert.match(source, /authenticateMcpRequest\(request, config, localCorsHeaders\)/);
  assert.doesNotMatch(source, /'Access-Control-Allow-Origin': '\*'/);

  assert.equal(isMcpOriginAllowed(null), true);
  assert.equal(isMcpOriginAllowed('null'), true);
  assert.equal(isMcpOriginAllowed('https://kakizzzzz.github.io'), true);
  assert.equal(isMcpOriginAllowed('https://unknown.example'), false);
  assert.equal(isMcpOriginAllowed('https://client.example', 'https://client.example'), true);
  assert.deepEqual(createMcpCorsHeaders(null)['Access-Control-Allow-Origin'], undefined);
  assert.equal(createMcpCorsHeaders('null')['Access-Control-Allow-Origin'], 'null');
  assert.equal(
    createMcpCorsHeaders('https://client.example')['Access-Control-Allow-Origin'],
    'https://client.example',
  );
});

test('protocol negotiation never echoes an unsupported client version', () => {
  assert.equal(negotiateMcpProtocolVersion(MCP_PROTOCOL_VERSION), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateMcpProtocolVersion('2099-12-31'), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateMcpProtocolVersion(null), MCP_PROTOCOL_VERSION);
  assert.equal(isSupportedMcpProtocolHeader(MCP_PROTOCOL_VERSION), true);
  assert.equal(isSupportedMcpProtocolHeader('2099-12-31'), false);
  assert.match(source, /protocolVersion: negotiateMcpProtocolVersion\(params\.protocolVersion\)/);
});

test('JSON-RPC classifiers distinguish requests, notifications, responses, and initialize', () => {
  const notification = { jsonrpc: '2.0', method: 'notifications/initialized' };
  const response = { jsonrpc: '2.0', id: 1, result: {} };
  const initialize = { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} };

  assert.equal(isJsonRpcNotification(notification), true);
  assert.equal(isJsonRpcResponse(response), true);
  assert.equal(isJsonRpcInitialize(initialize), true);
  assert.equal(isJsonRpcNotification(initialize), false);
  assert.match(source, /The initialize request must not be sent in a JSON-RPC batch/);
  assert.match(source, /status: 202/);
  assert.match(source, /results\.length === 0/);
});

test('cloud MCP exposes JSON Streamable HTTP instead of a legacy SSE endpoint', () => {
  assert.doesNotMatch(source, /event: endpoint/);
  assert.doesNotMatch(source, /data: \/mcp/);
  assert.match(source, /request\.method === 'GET'/);
  assert.match(source, /Allow: 'POST, OPTIONS'/);
});

test('cloud MCP does not call catch on the Supabase query builder', () => {
  assert.doesNotMatch(source, /\.eq\('id', data\.id\)\s*\.catch\(/);
  assert.match(source, /error: usageUpdateError/);
  assert.match(source, /MCP authentication failed unexpectedly/);
});

test('local and cloud transports publish the same complete nine-tool manifest', async () => {
  assert.equal(MCP_TOOL_NAMES.length, 9);
  assert.equal(new Set(MCP_TOOL_NAMES).size, 9);
  assert.equal(MCP_TOOL_MANIFEST.every(tool => tool.annotations.readOnlyHint === true), true);
  assert.equal(
    'semanticReview' in MCP_TOOL_MANIFEST[0].inputSchema.properties,
    false,
  );

  const server = await createMemoryMcpServer();
  const client = new Client({ name: 'manifest-parity-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name), MCP_TOOL_NAMES);
    for (const definition of MCP_TOOL_MANIFEST) {
      const local = listed.tools.find(tool => tool.name === definition.name);
      assert.ok(local, definition.name);
      assert.equal(local.title, definition.title, definition.name);
      assert.equal(local.description, definition.description, definition.name);
      assert.deepEqual(local.annotations, definition.annotations, definition.name);
      assert.deepEqual(
        withoutSchemaDialect(local.inputSchema),
        withoutSchemaDialect(definition.inputSchema),
        definition.name,
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('cloud MCP advertises the shared evidence-grounded research contract', () => {
  assert.match(source, /MCP_TOOL_MANIFEST/);
  assert.match(source, /buildMcpMemoryInstructions\(temporalPayload\?\.temporalContext\)/);
  assert.match(contractSource, /MCP_SERVER_VERSION = '1\.0\.0'/);
  assert.match(contractSource, /repeat directive\.exactText exactly and add nothing/i);
  assert.match(contractSource, /Never choose an option on the user’s behalf/);
  assert.match(contractSource, /confirmation token restores the original question/i);
  assert.doesNotMatch(contractSource, /semanticReview/);
  assert.match(contractSource, /contains no backend model, embeddings service, vector database, or paid inference API/);
});

test('Memory API restores the token-bound original query for short confirmation replies', () => {
  assert.match(memoryApiSource, /query = verifiedConfirmation\.originalQuery/);
  assert.match(memoryApiSource, /query: requestQuery/);
  assert.doesNotMatch(memoryApiSource, /semanticReview/);
});

test('structured output remains a strict four-state evidence firewall', () => {
  assert.match(source, /structuredContent: payload/);
  assert.match(publicSchemaSource, /oneOf: \[supported, ambiguous, notFound, candidateReview\]/);
  assert.match(publicSchemaSource, /additionalProperties: false/);
  assert.doesNotMatch(contractSource, /OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|QWEN_API_KEY/);
});

test('cloud MCP upgrades an empty literal search to contextual research', () => {
  assert.match(source, /toolName === 'search_memories'/);
  assert.match(source, /shouldUseContextualSearchFallback\(payload, args\)/);
  assert.match(source, /'research_memory_context'/);
  assert.match(source, /mergeContextualSearchFallback\(payload, contextual\)/);
});

test('cloud MCP exposes bounded private image blocks for relevant notes', () => {
  const imageTool = MCP_TOOL_MANIFEST.find(tool => tool.name === 'get_memory_images');
  assert.ok(imageTool);
  assert.equal(imageTool.inputSchema.properties.noteIds.maxItems, 10);
  assert.equal(imageTool.inputSchema.properties.maxImages.maximum, 6);
  assert.match(source, /buildMcpImageContent/);
  assert.match(source, /get_note_media/);
});
