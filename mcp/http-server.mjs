#!/usr/bin/env node
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMemoryMcpServer } from './memory-server.mjs';

const port = Number.parseInt(process.env.PORT || '3000', 10);
const authToken = (process.env.MCP_AUTH_TOKEN || '').trim();
const transports = new Map();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

const applyCors = res => {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
};

const sendJson = (res, status, payload) => {
  applyCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const sendMcpError = (res, status, code, message) => {
  sendJson(res, status, {
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
};

const readJsonBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      reject(new Error('Request body is too large.'));
      req.destroy();
    }
  });
  req.on('end', () => {
    if (!body.trim()) {
      resolve(undefined);
      return;
    }
    try {
      resolve(JSON.parse(body));
    } catch (error) {
      reject(error);
    }
  });
  req.on('error', reject);
});

const getHeader = (req, name) => {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const isAuthorized = req => {
  if (!authToken) return false;
  const authorization = getHeader(req, 'authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] === authToken;
};

const handleMcpRequest = async (req, res) => {
  applyCors(res);

  if (!isAuthorized(req)) {
    sendMcpError(res, 401, -32001, 'Unauthorized');
    return;
  }

  let parsedBody;
  if (req.method === 'POST') {
    try {
      parsedBody = await readJsonBody(req);
    } catch {
      sendMcpError(res, 400, -32700, 'Parse error: Invalid JSON');
      return;
    }
  }

  const sessionId = getHeader(req, 'mcp-session-id');
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (transport && !(transport instanceof StreamableHTTPServerTransport)) {
    sendMcpError(res, 400, -32000, 'Bad Request: Session uses a different transport protocol');
    return;
  }

  if (!transport) {
    if (sessionId) {
      sendMcpError(res, 404, -32000, 'Session not found');
      return;
    }

    if (req.method !== 'POST' || !isInitializeRequest(parsedBody)) {
      sendMcpError(res, 400, -32000, 'Bad Request: No valid session ID provided');
      return;
    }

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: initializedSessionId => {
        transports.set(initializedSessionId, transport);
      },
    });

    transport.onclose = () => {
      if (transport?.sessionId) {
        transports.delete(transport.sessionId);
      }
    };
    transport.onerror = error => {
      console.error('[mcp] transport error:', error);
    };

    const server = createMemoryMcpServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, parsedBody);
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      applyCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true, transport: 'streamable-http', endpoint: '/mcp' });
      return;
    }

    if (url.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not found', endpoint: '/mcp' });
      return;
    }

    if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
      sendMcpError(res, 405, -32000, 'Method not allowed');
      return;
    }

    await handleMcpRequest(req, res);
  } catch (error) {
    console.error('[mcp] request error:', error);
    if (!res.headersSent) {
      sendMcpError(res, 500, -32603, 'Internal server error');
    } else {
      res.end();
    }
  }
});

const shutdown = async () => {
  console.log('\nShutting down My Life Memory MCP HTTP server...');
  for (const [sessionId, transport] of transports.entries()) {
    try {
      await transport.close();
    } catch (error) {
      console.error(`[mcp] failed to close transport ${sessionId}:`, error);
    }
    transports.delete(sessionId);
  }
  server.close(() => process.exit(0));
};

if (!authToken) {
  console.error('Missing MCP_AUTH_TOKEN. Set it before starting the HTTP MCP server.');
  process.exit(1);
}

server.listen(port, '0.0.0.0', () => {
  console.log(`My Life Memory MCP Streamable HTTP server listening on http://0.0.0.0:${port}/mcp`);
  console.log('Transport: Streamable HTTP');
  console.log('Auth: Authorization: Bearer <MCP_AUTH_TOKEN>');
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
