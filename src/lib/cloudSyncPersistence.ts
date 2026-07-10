import type { CloudAppState, CloudProfile } from './cloudBackend';
import { saveCloudAppState } from './cloudBackend';
import { normalizePersistedAppState } from './appStateNormalize';
import { sanitizeRichHtmlFields } from './htmlSanitizer';
import { supabase } from './supabaseClient';
import type { PersistedAppState } from '../types/app';

const DB_NAME = 'my-life-memory-sync';
const DB_VERSION = 1;
const STORE_NAME = 'pending-snapshots';

const SENSITIVE_CLOUD_STATE_KEYS = new Set([
  'password',
  'loginpassword',
  'registerpassword',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'invitecode',
]);

export type PendingCloudSnapshot = {
  userId: string;
  state: PersistedAppState;
  profile: CloudProfile;
  baseRevision: number;
  sequence: number;
  savedAt: number;
  language: string;
};

export type CloudRevisionInfo = {
  revision: number;
  supported: boolean;
};

export class CloudStateConflictError extends Error {
  remoteRevision: number;

  constructor(remoteRevision: number) {
    super('Cloud state was changed by another device.');
    this.name = 'CloudStateConflictError';
    this.remoteRevision = remoteRevision;
  }
}

const sanitizeCloudValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(item => sanitizeCloudValue(item));
  if (!value || typeof value !== 'object') return value;

  const sanitized: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    if (SENSITIVE_CLOUD_STATE_KEYS.has(key.toLowerCase())) return;
    sanitized[key] = sanitizeCloudValue(entry);
  });
  return sanitized;
};

const sanitizeCloudAppState = (state: PersistedAppState): CloudAppState => (
  normalizePersistedAppState(
    sanitizeRichHtmlFields(sanitizeCloudValue(state) as PersistedAppState)
  ) || {}
) as CloudAppState;

const isMissingRevisionColumnError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message || '') : '';
  const text = `${code} ${message}`.toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (text.includes('revision') && text.includes('column'))
  );
};

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
});

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
  transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
});

const openSyncDatabase = async () => {
  if (typeof indexedDB === 'undefined') return null;
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'userId' });
    }
  };
  return requestResult(request);
};

export const readPendingCloudSnapshot = async (userId: string): Promise<PendingCloudSnapshot | null> => {
  const database = await openSyncDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const value = await requestResult(transaction.objectStore(STORE_NAME).get(userId));
    return value && typeof value === 'object' ? value as PendingCloudSnapshot : null;
  } finally {
    database.close();
  }
};

export const writePendingCloudSnapshot = async (snapshot: PendingCloudSnapshot) => {
  const database = await openSyncDatabase();
  if (!database) throw new Error('IndexedDB is unavailable.');
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(snapshot);
    await done;
  } finally {
    database.close();
  }
};

export const clearPendingCloudSnapshot = async (userId: string) => {
  const database = await openSyncDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(userId);
    await done;
  } finally {
    database.close();
  }
};

export const readCloudStateRevision = async (userId: string): Promise<CloudRevisionInfo> => {
  if (!supabase) return { revision: 0, supported: false };
  const { data, error } = await supabase
    .from('app_states')
    .select('revision')
    .eq('user_id', userId)
    .maybeSingle<{ revision: number | null }>();

  if (error) {
    if (isMissingRevisionColumnError(error)) return { revision: 0, supported: false };
    throw error;
  }

  return {
    revision: Math.max(0, Number(data?.revision) || 0),
    supported: true,
  };
};

export const saveCloudStateVersioned = async (
  state: PersistedAppState,
  expectedRevision: number,
  revisionSupported: boolean
): Promise<CloudRevisionInfo> => {
  if (!supabase) throw new Error('Cloud backend is not configured.');

  if (!revisionSupported) {
    await saveCloudAppState(state as CloudAppState);
    return { revision: expectedRevision, supported: false };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error('No active cloud session.');

  const nextRevision = expectedRevision + 1;
  const { data, error } = await supabase
    .from('app_states')
    .update({
      state: sanitizeCloudAppState(state),
      revision: nextRevision,
    })
    .eq('user_id', user.id)
    .eq('revision', expectedRevision)
    .select('revision')
    .maybeSingle<{ revision: number | null }>();

  if (error) {
    if (isMissingRevisionColumnError(error)) {
      await saveCloudAppState(state as CloudAppState);
      return { revision: expectedRevision, supported: false };
    }
    throw error;
  }

  if (!data) {
    const remote = await readCloudStateRevision(user.id);
    throw new CloudStateConflictError(remote.revision);
  }

  return {
    revision: Math.max(nextRevision, Number(data.revision) || nextRevision),
    supported: true,
  };
};
