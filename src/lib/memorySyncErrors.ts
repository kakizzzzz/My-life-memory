import type { MemoryMutation } from './normalizedMemory';

export type MemorySyncIssueKind =
  | 'network'
  | 'validation'
  | 'authorization'
  | 'storage'
  | 'server'
  | 'unknown';

export type MemorySyncErrorInfo = {
  kind: MemorySyncIssueKind;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
  retryable: boolean;
  occurredAt: number;
};

type ErrorRecord = Record<string, unknown>;

const diagnosticText = (value: unknown, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
};

const diagnosticNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export class NormalizedMemorySaveError extends Error {
  info: MemorySyncErrorInfo;

  constructor(info: MemorySyncErrorInfo) {
    super(info.message);
    this.name = 'NormalizedMemorySaveError';
    this.info = info;
  }
}

export const classifyMemorySyncError = (
  error: unknown,
  statusOverride?: number
): MemorySyncErrorInfo => {
  if (error instanceof NormalizedMemorySaveError) return error.info;

  const record = error && typeof error === 'object' ? error as ErrorRecord : {};
  const message = diagnosticText(
    error instanceof Error ? error.message : record.message,
    'Normalized memory save failed.'
  );
  const code = diagnosticText(record.code);
  const details = diagnosticText(record.details);
  const hint = diagnosticText(record.hint);
  const status = statusOverride ?? diagnosticNumber(record.status ?? record.statusCode);
  const lower = `${message} ${details} ${hint}`.toLowerCase();
  const occurredAt = Date.now();

  if (error instanceof Error && error.name === 'MemoryMutationValidationError') {
    return { kind: 'validation', message, code, details, hint, status, retryable: false, occurredAt };
  }
  if (error instanceof Error && (
    error.name === 'InvalidStateError'
    || error.name === 'QuotaExceededError'
    || error.name === 'UnknownError'
  )) {
    return { kind: 'storage', message, code, details, hint, status, retryable: true, occurredAt };
  }
  if (code === '22023' || code === '22P02' || code === '23514'
    || status === 400 || status === 409 || status === 422
    || /invalid|unsafe|too (?:large|many)|missing its|unsupported type/.test(lower)) {
    return { kind: 'validation', message, code, details, hint, status, retryable: false, occurredAt };
  }
  if (code === '42501' || status === 401 || status === 403
    || /jwt|permission|not authorized|unauthorized|forbidden/.test(lower)) {
    return { kind: 'authorization', message, code, details, hint, status, retryable: false, occurredAt };
  }
  if (status === 0 || error instanceof TypeError
    || /network|failed to fetch|fetch failed|load failed|offline|connection/.test(lower)) {
    return { kind: 'network', message, code, details, hint, status, retryable: true, occurredAt };
  }
  if (typeof status === 'number' && status >= 500) {
    return { kind: 'server', message, code, details, hint, status, retryable: true, occurredAt };
  }
  return { kind: 'unknown', message, code, details, hint, status, retryable: true, occurredAt };
};

export const memorySyncErrorForStorage = (error: unknown) => {
  const classified = classifyMemorySyncError(error);
  return classified.kind === 'storage' ? classified : {
    ...classified,
    kind: 'storage' as const,
  };
};

export const memorySyncValidationError = (message: string): MemorySyncErrorInfo => ({
  kind: 'validation',
  message: diagnosticText(message, 'A local memory change cannot be synchronized safely.'),
  retryable: false,
  occurredAt: Date.now(),
});

export const memorySyncIssueSummary = (info: MemorySyncErrorInfo) => {
  const code = info.code ? ` [${info.code}]` : '';
  return `${info.message}${code}`.slice(0, 600);
};

const shortEntityHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const logMemorySyncFailure = ({
  info,
  mutations,
  expectedRevision,
  remoteRevision,
  sequence,
  inFlightCount,
}: {
  info: MemorySyncErrorInfo;
  mutations: MemoryMutation[];
  expectedRevision: number;
  remoteRevision: number;
  sequence: number;
  inFlightCount: number;
}) => {
  console.error('Normalized memory sync failed:', {
    kind: info.kind,
    code: info.code || undefined,
    status: info.status,
    message: info.message,
    details: info.details || undefined,
    hint: info.hint || undefined,
    retryable: info.retryable,
    mutationCount: mutations.length,
    mutationTypes: [...new Set(mutations.map(item => item.type))],
    entityRefs: mutations.slice(0, 20).map(item => `${item.type}:${shortEntityHash(item.entityId)}`),
    expectedRevision,
    remoteRevision,
    sequence,
    inFlightCount,
  });
};
