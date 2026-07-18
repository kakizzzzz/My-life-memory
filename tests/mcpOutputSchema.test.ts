import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { memoryResearchOutputSchema } from '../mcp/memory-output-schema.mjs';

const notFoundResult = {
  ok: true,
  source: 'my-life-memory-normalized-v2',
  action: 'research_memory_context',
  query: 'missing memory',
  timestamp: '2026-07-18T00:00:00.000Z',
  temporalContext: {
    timeZone: 'Asia/Shanghai',
    currentUtcDateTime: '2026-07-18T00:00:00.000Z',
    currentLocalDate: '2026-07-18',
    currentLocalDateTime: '2026-07-18T08:00:00+08:00',
    currentDateRole: 'query-evaluation-only',
  },
  schemaVersion: '2',
  status: 'not-found',
  directive: {
    action: 'STATE_NO_EVIDENCE_EXACT',
    exactText: 'No matching memory evidence was found.',
    mayAddExplanation: false,
  },
  clarification: null,
  evidence: null,
};

test('local MCP SDK publishes and validates the structured memory output schema', async () => {
  const server = new McpServer({ name: 'schema-test', version: '1.0.0' });
  server.registerTool('research_memory_context', {
    inputSchema: {},
    outputSchema: memoryResearchOutputSchema,
    annotations: { readOnlyHint: true },
  }, async () => ({
    content: [{ type: 'text', text: notFoundResult.directive.exactText }],
    structuredContent: notFoundResult,
  }));

  const client = new Client({ name: 'schema-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find(item => item.name === 'research_memory_context');
    assert.ok(tool?.outputSchema);
    assert.equal(tool.outputSchema.type, 'object');
    assert.equal(tool.outputSchema.additionalProperties, false);

    const result = await client.callTool({ name: 'research_memory_context', arguments: {} });
    assert.deepEqual(result.structuredContent, notFoundResult);
    assert.equal(result.content[0]?.type, 'text');
    assert.equal(result.content[0]?.text, notFoundResult.directive.exactText);
  } finally {
    await client.close();
    await server.close();
  }
});

test('local MCP output schema rejects fields forbidden by a non-supported state', () => {
  const result = memoryResearchOutputSchema.safeParse({
    ...notFoundResult,
    classification: {
      label: 'travel',
      confidenceKind: 'heuristic',
      confidenceBand: 'low',
    },
  });
  assert.equal(result.success, false);
});
