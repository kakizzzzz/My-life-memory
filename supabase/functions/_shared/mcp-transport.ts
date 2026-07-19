export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const SUPPORTED_MCP_PROTOCOL_VERSIONS = [MCP_PROTOCOL_VERSION] as const;

const DEFAULT_ALLOWED_ORIGINS = [
  'https://kakizzzzz.github.io',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
];

export const negotiateMcpProtocolVersion = (requested: unknown) => (
  typeof requested === 'string'
  && SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(requested as typeof MCP_PROTOCOL_VERSION)
    ? requested
    : MCP_PROTOCOL_VERSION
);

export const isSupportedMcpProtocolHeader = (value: string | null) => (
  !value || SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(value as typeof MCP_PROTOCOL_VERSION)
);

export const configuredMcpOrigins = (configured = '') => new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...configured.split(',').map(value => value.trim()).filter(Boolean),
]);

export const isMcpOriginAllowed = (origin: string | null, configured = '') => (
  origin === null
  || origin === 'null'
  || configuredMcpOrigins(configured).has(origin)
);

export const createMcpCorsHeaders = (origin: string | null) => {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'mcp-session-id',
    Vary: 'Origin',
  };
  if (origin === 'null') headers['Access-Control-Allow-Origin'] = 'null';
  else if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
};

export const isJsonRpcResponse = (value: unknown): value is Record<string, unknown> => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (value as Record<string, unknown>).jsonrpc === '2.0'
  && !('method' in (value as Record<string, unknown>))
  && 'id' in (value as Record<string, unknown>)
  && ('result' in (value as Record<string, unknown>) || 'error' in (value as Record<string, unknown>))
);

export const isJsonRpcNotification = (value: unknown): value is Record<string, unknown> => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (value as Record<string, unknown>).jsonrpc === '2.0'
  && typeof (value as Record<string, unknown>).method === 'string'
  && !('id' in (value as Record<string, unknown>))
);

export const isJsonRpcInitialize = (value: unknown) => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (value as Record<string, unknown>).method === 'initialize'
);
