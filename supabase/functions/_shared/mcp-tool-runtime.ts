type ErrorRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ErrorRecord => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const stringValue = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const errorDetails = (payload: unknown) => {
  const root = isRecord(payload) ? payload : {};
  const nested = isRecord(root.error) ? root.error : root;
  return {
    code: stringValue(nested.code) || stringValue(root.code) || 'memory_api_error',
    message: stringValue(nested.message)
      || stringValue(nested.msg)
      || stringValue(root.message)
      || stringValue(root.msg),
    hasStructuredError: isRecord(root.error),
  };
};

const publicMessageFor = (status: number, message: string) => {
  if (status === 401) return 'Memory access was not authorized.';
  if (status === 429) return message || 'Memory access is temporarily rate limited. Please retry shortly.';
  return message || 'The memory request could not be completed.';
};

export class MemoryApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly expectedToolError: boolean;
  readonly publicMessage: string;

  constructor({
    status,
    code,
    message,
    expectedToolError,
    publicMessage,
  }: {
    status: number;
    code: string;
    message: string;
    expectedToolError: boolean;
    publicMessage: string;
  }) {
    super(message);
    this.name = 'MemoryApiRequestError';
    this.status = status;
    this.code = code;
    this.expectedToolError = expectedToolError;
    this.publicMessage = publicMessage;
  }
}

export const createMemoryApiRequestError = (status: number, payload: unknown) => {
  const details = errorDetails(payload);
  const expectedToolError = (status >= 400 && status < 500)
    || (status >= 200 && status < 300 && details.hasStructuredError);
  return new MemoryApiRequestError({
    status,
    code: details.code,
    message: `Memory API ${status || 'response'} failed (${details.code}).`,
    expectedToolError,
    publicMessage: expectedToolError
      ? publicMessageFor(status, details.message)
      : 'The memory service encountered an internal error.',
  });
};

export const mcpToolErrorResult = (message: string) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

export const expectedMemoryApiToolResult = (error: unknown) => (
  error instanceof MemoryApiRequestError && error.expectedToolError
    ? mcpToolErrorResult(error.publicMessage)
    : null
);
