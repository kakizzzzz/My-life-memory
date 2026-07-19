import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemoryMcpServer } from '../mcp/memory-server.mjs';
import {
  createMemoryApiRequestError,
  expectedMemoryApiToolResult,
} from '../supabase/functions/_shared/mcp-tool-runtime.ts';
import { validateMcpToolArguments } from '../supabase/functions/_shared/mcp-tool-validation.mjs';

test('shared MCP validation applies manifest defaults', () => {
  assert.deepEqual(validateMcpToolArguments('search_memories', {}), {
    ok: true,
    value: { query: '', limit: 20 },
  });
  assert.deepEqual(validateMcpToolArguments('get_routes', {}), {
    ok: true,
    value: { includePaths: false },
  });
  assert.deepEqual(validateMcpToolArguments('research_memory_context', { query: 'memory' }), {
    ok: true,
    value: { query: 'memory', radiusKm: 5, limit: 30 },
  });
  assert.deepEqual(validateMcpToolArguments('get_memory_images', { noteIds: ['note-1'] }), {
    ok: true,
    value: { noteIds: ['note-1'], maxImages: 3 },
  });
});

test('shared MCP validation rejects malformed or overly broad calls', () => {
  const cases = [
    ['search_memories', { query: 123 }, /query must be a string/],
    ['search_memories', { unexpected: true }, /unknown field: unexpected/],
    ['search_memories', { limit: 101 }, /limit must be at most 100/],
    ['search_memories', { limit: 1.5 }, /limit must be an integer/],
    ['get_location_memory', {}, /starId is required/],
    ['get_day_memory', { date: '18-07-2026' }, /date has an invalid format/],
    ['get_memory_images', { noteIds: ['note-1', 'note-1'] }, /noteIds must contain unique items/],
    ['get_memory_images', { noteIds: [] }, /noteIds must contain at least 1 item/],
  ] as const;

  for (const [toolName, input, expected] of cases) {
    const result = validateMcpToolArguments(toolName, input);
    assert.equal(result.ok, false, toolName);
    assert.match(result.message, expected, toolName);
  }
});

test('expected Memory API failures become MCP tool errors without HTTP-style server failures', () => {
  for (const [status, code, message] of [
    [400, 'bad_request', 'date must be YYYY-MM-DD.'],
    [404, 'not_found', 'Location was not found.'],
    [429, 'rate_limited', 'Too many requests.'],
  ] as const) {
    const error = createMemoryApiRequestError(status, { error: { code, message } });
    assert.equal(error.expectedToolError, true);
    const result = expectedMemoryApiToolResult(error);
    assert.ok(result);
    assert.equal(result.isError, true);
    assert.equal(result.content[0].type, 'text');
    assert.equal(result.content[0].text, message);
  }

  const internal = createMemoryApiRequestError(500, {
    error: { code: 'unexpected_error', message: 'private database detail' },
  });
  assert.equal(internal.expectedToolError, false);
  assert.equal(expectedMemoryApiToolResult(internal), null);
  assert.equal(internal.publicMessage, 'The memory service encountered an internal error.');
});

test('local MCP also enforces shared constraints before any memory request', async () => {
  const server = await createMemoryMcpServer();
  const client = new Client({ name: 'runtime-validation-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({
      name: 'get_memory_images',
      arguments: { noteIds: ['note-1', 'note-1'] },
    });
    assert.equal(result.isError, true);
    assert.match(String(result.content[0]?.text || ''), /unique items/);

    const emptyToolResult = await client.callTool({
      name: 'list_locations',
      arguments: { unexpected: true },
    });
    assert.equal(emptyToolResult.isError, true);
    assert.match(String(emptyToolResult.content[0]?.text || ''), /Unrecognized key|unknown field/);
  } finally {
    await client.close();
    await server.close();
  }
});
