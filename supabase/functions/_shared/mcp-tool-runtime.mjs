const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stringValue = value => (typeof value === 'string' ? value.trim() : '');

const errorDetails = payload => {
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

const publicMessageFor = (status, message) => {
  if (status === 401) return 'Memory access was not authorized.';
  if (status === 429) return message || 'Memory access is temporarily rate limited. Please retry shortly.';
  return message || 'The memory request could not be completed.';
};

export const MEMORY_API_INTERNAL_ERROR_MESSAGE = 'The memory service encountered an internal error.';

export class MemoryApiRequestError extends Error {
  constructor({
    status,
    code,
    expectedToolError,
    publicMessage,
  }) {
    super(publicMessage);
    this.name = 'MemoryApiRequestError';
    this.status = status;
    this.code = code;
    this.expectedToolError = expectedToolError;
    this.publicMessage = publicMessage;
  }
}

export const createMemoryApiRequestError = (status, payload) => {
  const details = errorDetails(payload);
  const expectedToolError = (status >= 400 && status < 500)
    || (status >= 200 && status < 300 && details.hasStructuredError);
  return new MemoryApiRequestError({
    status,
    code: details.code,
    expectedToolError,
    publicMessage: expectedToolError
      ? publicMessageFor(status, details.message)
      : MEMORY_API_INTERNAL_ERROR_MESSAGE,
  });
};

export const mcpToolErrorResult = message => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

export const expectedMemoryApiToolResult = error => (
  error instanceof MemoryApiRequestError && error.expectedToolError
    ? mcpToolErrorResult(error.publicMessage)
    : null
);
