import type { InternalMemoryReferenceOption } from './memory-reference-candidates.ts';

const TOKEN_PREFIX = 'mlmr1';
const DEFAULT_TTL_MS = 20 * 60_000;
const MAX_TOKEN_CHARACTERS = 16_384;

type TokenOption = Omit<InternalMemoryReferenceOption, 'score'> & {
  optionId: string;
};

type MemoryReferenceTokenPayload = {
  version: 1;
  userId: string;
  queryHash: string;
  revision: number;
  expiresAt: number;
  options: TokenOption[];
};

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlToBytes = (value: string) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const sha256 = async (value: string) => new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
);

const queryHash = async (query: string) => bytesToBase64Url(
  await sha256(query.normalize('NFKC').trim()),
);

const encryptionKey = async (secret: string) => crypto.subtle.importKey(
  'raw',
  await sha256(`my-life-memory/reference/${secret}`),
  { name: 'AES-GCM' },
  false,
  ['encrypt', 'decrypt'],
);

const validOption = (value: unknown): value is TokenOption => {
  if (!value || typeof value !== 'object') return false;
  const option = value as Record<string, unknown>;
  return typeof option.optionId === 'string'
    && typeof option.noteId === 'string'
    && typeof option.starId === 'string'
    && typeof option.label === 'string'
    && ['home', 'work', 'study', 'observation', 'activity'].includes(String(option.relation));
};

export const createMemoryReferenceToken = async ({
  secret,
  userId,
  query,
  revision,
  options,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
}: {
  secret: string;
  userId: string;
  query: string;
  revision: number;
  options: InternalMemoryReferenceOption[];
  now?: number;
  ttlMs?: number;
}) => {
  if (!secret.trim()) throw new Error('reference_confirmation_secret_missing');
  const tokenOptions: TokenOption[] = options.slice(0, 4).map((option, index) => ({
    optionId: `op_${index + 1}`,
    noteId: option.noteId,
    starId: option.starId,
    relation: option.relation,
    label: option.label,
  }));
  const payload: MemoryReferenceTokenPayload = {
    version: 1,
    userId,
    queryHash: await queryHash(query),
    revision: Math.max(0, Number(revision) || 0),
    expiresAt: now + Math.max(60_000, Math.min(ttlMs, 60 * 60_000)),
    options: tokenOptions,
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(payload)),
  ));
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv, 0);
  packed.set(encrypted, iv.length);
  return {
    token: `${TOKEN_PREFIX}.${bytesToBase64Url(packed)}`,
    options: tokenOptions.map(({ optionId, label }) => ({ optionId, label })),
  };
};

export const verifyMemoryReferenceToken = async ({
  secret,
  token,
  userId,
  query,
  revision,
  now = Date.now(),
}: {
  secret: string;
  token: string;
  userId: string;
  query: string;
  revision: number;
  now?: number;
}): Promise<{
  valid: boolean;
  reason: 'valid' | 'invalid-format' | 'invalid-token' | 'wrong-user' | 'wrong-query' | 'stale-revision' | 'expired';
  options: TokenOption[];
}> => {
  if (!secret.trim() || token.length > MAX_TOKEN_CHARACTERS || !token.startsWith(`${TOKEN_PREFIX}.`)) {
    return { valid: false, reason: 'invalid-format', options: [] };
  }
  try {
    const encodedPayload = token.slice(TOKEN_PREFIX.length + 1);
    if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload)) {
      return { valid: false, reason: 'invalid-token', options: [] };
    }
    const packed = base64UrlToBytes(encodedPayload);
    if (bytesToBase64Url(packed) !== encodedPayload) {
      return { valid: false, reason: 'invalid-token', options: [] };
    }
    if (packed.length <= 28) return { valid: false, reason: 'invalid-format', options: [] };
    const iv = packed.slice(0, 12);
    const ciphertext = packed.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      await encryptionKey(secret),
      ciphertext,
    );
    const payload = JSON.parse(new TextDecoder().decode(decrypted)) as MemoryReferenceTokenPayload;
    const options = Array.isArray(payload.options) ? payload.options.filter(validOption).slice(0, 4) : [];
    if (payload.version !== 1 || options.length === 0) return { valid: false, reason: 'invalid-token', options: [] };
    if (payload.userId !== userId) return { valid: false, reason: 'wrong-user', options: [] };
    if (payload.queryHash !== await queryHash(query)) return { valid: false, reason: 'wrong-query', options: [] };
    if (payload.revision !== Math.max(0, Number(revision) || 0)) return { valid: false, reason: 'stale-revision', options: [] };
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= now) return { valid: false, reason: 'expired', options: [] };
    return { valid: true, reason: 'valid', options };
  } catch {
    return { valid: false, reason: 'invalid-token', options: [] };
  }
};
