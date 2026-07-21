import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createLocalMemoryApiCaller,
  createMemoryMcpServer,
} from '../mcp/memory-server.mjs';
import {
  createMemoryApiRequestError,
  expectedMemoryApiToolResult,
  MEMORY_API_INTERNAL_ERROR_MESSAGE,
} from '../supabase/functions/_shared/mcp-tool-runtime.mjs';
import { validateMcpToolArguments } from '../supabase/functions/_shared/mcp-tool-validation.mjs';
import { researchMemoryContext } from '../supabase/functions/_shared/memory-research.ts';

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
    value: { query: 'memory', limit: 30 },
  });
  assert.deepEqual(validateMcpToolArguments('get_memory_images', { noteIds: ['note-1'] }), {
    ok: true,
    value: { noteIds: ['note-1'], maxImages: 3 },
  });
});

test('validated research input preserves explicit-radius semantics and internal fallback', () => {
  const homeInput = validateMcpToolArguments('research_memory_context', { query: '我家在哪？' });
  assert.equal(homeInput.ok, true);
  assert.equal(Object.hasOwn(homeInput.value, 'radiusKm'), false);

  const homeResult = researchMemoryContext({
    userId: 'user-1',
    account: 'owner',
    profile: null,
    revision: 1,
    stars: [{
      id: 'home-star',
      sort_order: 0,
      lat: 31,
      lng: 121,
      created_at_ms: Date.parse('2026-01-01T12:00:00Z'),
      tag_order: null,
      tag_group_id: null,
      color: '#cccccc',
    }],
    notes: [{
      star_id: 'home-star',
      id: 'home-note',
      sort_order: 0,
      title: '',
      title_html: '',
      content: '这里是我家。',
      content_html: '<p>这里是我家。</p>',
      image_url: null,
      image_urls: [],
      images: [],
      font_size: null,
      title_font_size: null,
      color: null,
      created_at_ms: Date.parse('2026-01-01T12:00:00Z'),
      updated_at_ms: Date.parse('2026-01-01T12:00:00Z'),
    }],
    tracks: [],
  }, homeInput.value);
  assert.equal(homeResult.queryPlan.spatialRelation, 'exact');

  const coordinateInput = validateMcpToolArguments('research_memory_context', {
    query: '查看这里的记忆',
    centerLat: 31,
    centerLng: 121,
  });
  assert.equal(coordinateInput.ok, true);
  assert.equal(Object.hasOwn(coordinateInput.value, 'radiusKm'), false);
  const coordinateResult = researchMemoryContext({
    userId: 'user-1',
    account: 'owner',
    profile: null,
    revision: 1,
    stars: [],
    notes: [],
    tracks: [],
  }, coordinateInput.value);
  assert.equal(coordinateResult.searchPlan.resolvedRegion?.mode, 'radius');
  assert.equal(coordinateResult.searchPlan.resolvedRegion?.radiusKm, 5);
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

test('local MCP keeps actionable 4xx errors and hides Memory API 5xx details', async () => {
  const invoke = async (status: number, message: string) => {
    const memoryApiCaller = createLocalMemoryApiCaller({
      endpoint: 'https://memory.example.test',
      apiKey: 'public-test-key',
      accessTokenProvider: async () => 'test-access-token',
      fetchImpl: async () => new Response(JSON.stringify({
        error: { code: status === 500 ? 'database_failure' : 'bad_request', message },
      }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const server = await createMemoryMcpServer({ memoryApiCaller });
    const client = new Client({ name: `local-error-${status}`, version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      return await client.callTool({ name: 'list_locations', arguments: {} });
    } finally {
      await client.close();
      await server.close();
    }
  };

  const expected = await invoke(400, 'Choose a valid date range.');
  assert.equal(expected.isError, true);
  assert.match(String(expected.content[0]?.text || ''), /Choose a valid date range/);

  const internal = await invoke(500, 'private database detail');
  assert.equal(internal.isError, true);
  const internalText = String(internal.content[0]?.text || '');
  assert.equal(internalText, MEMORY_API_INTERNAL_ERROR_MESSAGE);
  assert.doesNotMatch(internalText, /private database detail/);
});

test('local search fallback preserves supported record-only research without archive traversal', async () => {
  const actions: string[] = [];
  const memoryApiCaller = async (action: string, input: Record<string, unknown> = {}) => {
    actions.push(action);
    if (action === 'get_temporal_context') return { temporalContext: null };
    if (action === 'search_memories') return { query: input.query, count: 0, records: [] };
    if (action === 'research_memory_context') return {
      schemaVersion: '2',
      status: 'supported',
      directive: { action: 'ANSWER_FROM_EVIDENCE', exactText: null, mayAddExplanation: true },
      evidence: {
        passages: [],
        records: [{
          id: 'synthetic-note',
          starId: 'synthetic-star',
          title: 'Synthetic memory',
          excerpt: 'A synthetic scoped record.',
          createdAt: 1,
          localDate: '1970-01-01',
          hasImages: false,
          coordinates: { lat: 35, lng: 139 },
        }],
        locations: [],
        routes: [],
        verifiedPlaceNames: ['Japan'],
        selectedImageNoteIds: [],
      },
      confidenceKind: 'heuristic',
      confidenceBand: 'medium',
      reasonCodes: ['server-authorized-records'],
    };
    throw new Error(`Unexpected archive traversal: ${action}`);
  };
  const server = await createMemoryMcpServer({ memoryApiCaller });
  const client = new Client({ name: 'record-only-fallback-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const result = await client.callTool({
      name: 'search_memories',
      arguments: { query: 'Japan trip memories' },
    });
    const text = String(result.content[0]?.type === 'text' ? result.content[0].text : '');
    assert.match(text, /synthetic-note/);
    assert.match(text, /1970-01-01/);
    assert.deepEqual(actions, [
      'get_temporal_context',
      'search_memories',
      'research_memory_context',
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
