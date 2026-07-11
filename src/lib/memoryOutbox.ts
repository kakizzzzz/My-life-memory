import type { PersistedAppState } from '../types/app';
import type { CloudProfile } from './cloudBackend';
import {
  compactMemoryMutations,
  diffMemoryState,
  validateMemoryMutations,
  type MemoryMutation,
} from './normalizedMemory';

type PendingCloudSnapshot = {
  userId: string;
  state: PersistedAppState;
  profile: CloudProfile;
  baseRevision: number;
  sequence: number;
  savedAt: number;
  language: string;
  baseState?: PersistedAppState;
};

const DB_NAME = 'my-life-memory-sync';
const DB_VERSION = 2;
const LEGACY_STORE_NAME = 'pending-snapshots';
const OUTBOX_STORE_NAME = 'memory-mutation-outbox';

export type MemoryMutationOutbox = {
  userId: string;
  expectedRevision: number;
  mutations: MemoryMutation[];
  inFlightBatch?: {
    expectedRevision: number;
    mutations: MemoryMutation[];
    startedAt: number;
  };
  sequence: number;
  savedAt: number;
  language: string;
  legacySnapshotMigratedAt?: number;
  legacySnapshotBlocked?: boolean;
  lastError?: string;
};

type MigratedPendingCloudSnapshot = PendingCloudSnapshot & {
  migratedToMutationOutboxAt?: number;
  migrationBlockedReason?: string;
};

const isSafeUserMediaPath = (path: string, userId: string) => (
  path.startsWith(`${userId}/`)
  && path.length <= 1024
  && /^[A-Za-z0-9_./-]+$/.test(path)
  && !/(^|\/)\.\.?(\/|$)/.test(path)
  && !path.includes('//')
);

export const extractPendingMemoryMediaPaths = (value: unknown, userId: string) => {
  const paths = new Set<string>();
  const visited = new Set<object>();
  const addPath = (candidate: unknown) => {
    const path = typeof candidate === 'string' ? candidate.trim() : '';
    if (isSafeUserMediaPath(path, userId)) paths.add(path);
  };
  const inspect = (entry: unknown) => {
    if (typeof entry === 'string') {
      for (const match of entry.matchAll(/data-(?:media|storage)-(?:path|key)=["']([^"']+)["']/gi)) {
        addPath(match[1]);
      }
      const storagePath = entry.match(/^storage:\/\/life-media\/(.+)$/i)?.[1];
      if (storagePath) addPath(storagePath);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(inspect);
      return;
    }
    if (!entry || typeof entry !== 'object' || visited.has(entry)) return;
    visited.add(entry);
    const object = entry as Record<string, unknown>;
    if (object.provider === 'supabase' && object.bucket === 'life-media') {
      addPath(object.path || object.key);
    }
    Object.values(object).forEach(inspect);
  };
  inspect(value);
  return [...paths];
};

export const convertLegacyPendingSnapshotToMutations = (
  legacy: PendingCloudSnapshot,
  remoteProfile: CloudProfile
) => {
  if (!legacy.baseState) return null;
  return diffMemoryState({
    baseState: legacy.baseState,
    nextState: legacy.state,
    baseProfile: cloudProfileFromState(legacy.baseState, remoteProfile),
    nextProfile: legacy.profile,
  });
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

const openDatabase = async () => {
  if (typeof indexedDB === 'undefined') return null;
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(LEGACY_STORE_NAME)) {
      database.createObjectStore(LEGACY_STORE_NAME, { keyPath: 'userId' });
    }
    if (!database.objectStoreNames.contains(OUTBOX_STORE_NAME)) {
      database.createObjectStore(OUTBOX_STORE_NAME, { keyPath: 'userId' });
    }
  };
  return requestResult(request);
};

const prepareOutboxForStorage = (outbox: MemoryMutationOutbox): MemoryMutationOutbox => ({
  ...outbox,
  expectedRevision: Math.max(0, outbox.expectedRevision),
  mutations: compactMemoryMutations(outbox.mutations),
  inFlightBatch: outbox.inFlightBatch ? {
    ...outbox.inFlightBatch,
    expectedRevision: Math.max(0, outbox.inFlightBatch.expectedRevision),
    mutations: compactMemoryMutations(outbox.inFlightBatch.mutations),
  } : undefined,
  savedAt: Date.now(),
});

export const readMemoryMutationOutbox = async (userId: string): Promise<MemoryMutationOutbox | null> => {
  const database = await openDatabase();
  if (!database) return null;
  try {
    const transaction = database.transaction(OUTBOX_STORE_NAME, 'readonly');
    const value = await requestResult(transaction.objectStore(OUTBOX_STORE_NAME).get(userId));
    return value && typeof value === 'object' ? value as MemoryMutationOutbox : null;
  } finally {
    database.close();
  }
};

export const writeMemoryMutationOutbox = async (outbox: MemoryMutationOutbox) => {
  const database = await openDatabase();
  if (!database) throw new Error('IndexedDB is unavailable.');
  try {
    const transaction = database.transaction(OUTBOX_STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(OUTBOX_STORE_NAME).put(prepareOutboxForStorage(outbox));
    await done;
  } finally {
    database.close();
  }
};

export const readPendingMemoryMediaPaths = async (userId: string) => {
  const database = await openDatabase();
  if (!database) return [];
  try {
    const transaction = database.transaction([LEGACY_STORE_NAME, OUTBOX_STORE_NAME], 'readonly');
    const [legacy, outbox] = await Promise.all([
      requestResult(transaction.objectStore(LEGACY_STORE_NAME).get(userId)) as Promise<MigratedPendingCloudSnapshot | undefined>,
      requestResult(transaction.objectStore(OUTBOX_STORE_NAME).get(userId)) as Promise<MemoryMutationOutbox | undefined>,
    ]);
    const protectedValues: unknown[] = [outbox];
    if (legacy && (!legacy.migratedToMutationOutboxAt || outbox?.legacySnapshotBlocked)) {
      protectedValues.push(legacy.state, legacy.profile, legacy.baseState);
    }
    return extractPendingMemoryMediaPaths(protectedValues, userId);
  } finally {
    database.close();
  }
};

export const clearMemoryMutationOutbox = async (userId: string) => {
  const database = await openDatabase();
  if (!database) return;
  try {
    const transaction = database.transaction(OUTBOX_STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    transaction.objectStore(OUTBOX_STORE_NAME).delete(userId);
    await done;
  } finally {
    database.close();
  }
};

export const markLegacyPendingSnapshotResolved = async (userId: string) => {
  const database = await openDatabase();
  if (!database) return;
  try {
    const readTransaction = database.transaction(LEGACY_STORE_NAME, 'readonly');
    const legacy = await requestResult(
      readTransaction.objectStore(LEGACY_STORE_NAME).get(userId)
    ) as MigratedPendingCloudSnapshot | undefined;
    if (!legacy || legacy.migratedToMutationOutboxAt) return;
    const writeTransaction = database.transaction(LEGACY_STORE_NAME, 'readwrite');
    const done = transactionDone(writeTransaction);
    writeTransaction.objectStore(LEGACY_STORE_NAME).put({
      ...legacy,
      migratedToMutationOutboxAt: Date.now(),
      migrationBlockedReason: 'Resolved by choosing the verified cloud copy.',
    });
    await done;
  } finally {
    database.close();
  }
};

export const enqueueMemoryMutations = async ({
  userId,
  expectedRevision,
  mutations,
  language,
}: {
  userId: string;
  expectedRevision: number;
  mutations: MemoryMutation[];
  language: string;
}) => {
  if (mutations.length === 0) return readMemoryMutationOutbox(userId);
  const database = await openDatabase();
  if (!database) throw new Error('IndexedDB is unavailable.');
  let next: MemoryMutationOutbox | null = null;
  try {
    const transaction = database.transaction(OUTBOX_STORE_NAME, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(OUTBOX_STORE_NAME);
    const request = store.get(userId);
    request.onsuccess = () => {
      try {
        const existing = request.result && typeof request.result === 'object'
          ? request.result as MemoryMutationOutbox
          : null;
        next = prepareOutboxForStorage({
          userId,
          expectedRevision: existing?.expectedRevision ?? expectedRevision,
          mutations: [...(existing?.mutations || []), ...mutations],
          sequence: (existing?.sequence || 0) + 1,
          savedAt: Date.now(),
          language,
          legacySnapshotMigratedAt: existing?.legacySnapshotMigratedAt,
          legacySnapshotBlocked: existing?.legacySnapshotBlocked,
          inFlightBatch: existing?.inFlightBatch,
        });
        store.put(next);
      } catch {
        transaction.abort();
      }
    };
    await done;
    if (!next) throw new Error('Could not persist memory changes.');
    return next;
  } finally {
    database.close();
  }
};

const cloudProfileFromState = (state: PersistedAppState, fallback: CloudProfile): CloudProfile => ({
  account: state.profile?.account || fallback.account,
  name: state.profile?.name || fallback.name,
  avatarUrl: state.profile?.avatarUrl || fallback.avatarUrl,
});

export const upgradeLegacyPendingSnapshot = async ({
  userId,
  remoteState,
  remoteProfile,
  remoteRevision,
}: {
  userId: string;
  remoteState: PersistedAppState;
  remoteProfile: CloudProfile;
  remoteRevision: number;
}) => {
  const database = await openDatabase();
  if (!database) return { outbox: null, blocked: false };
  try {
    const readTransaction = database.transaction([LEGACY_STORE_NAME, OUTBOX_STORE_NAME], 'readonly');
    const legacyRequest = readTransaction.objectStore(LEGACY_STORE_NAME).get(userId);
    const existingRequest = readTransaction.objectStore(OUTBOX_STORE_NAME).get(userId);
    const [legacy, existing] = await Promise.all([
      requestResult(legacyRequest) as Promise<MigratedPendingCloudSnapshot | undefined>,
      requestResult(existingRequest) as Promise<MemoryMutationOutbox | undefined>,
    ]);

    if (!legacy || legacy.migratedToMutationOutboxAt) {
      return { outbox: existing || null, blocked: Boolean(existing?.legacySnapshotBlocked) };
    }

    if (!legacy.baseState) {
      const blockedOutbox: MemoryMutationOutbox = {
        userId,
        expectedRevision: Math.max(0, remoteRevision),
        mutations: existing?.mutations || [],
        sequence: (existing?.sequence || 0) + 1,
        savedAt: Date.now(),
        language: legacy.language || 'en',
        legacySnapshotBlocked: true,
        inFlightBatch: existing?.inFlightBatch,
        lastError: 'Legacy pending snapshot has no baseState and cannot be converted safely.',
      };
      const writeTransaction = database.transaction([LEGACY_STORE_NAME, OUTBOX_STORE_NAME], 'readwrite');
      const done = transactionDone(writeTransaction);
      writeTransaction.objectStore(LEGACY_STORE_NAME).put({
        ...legacy,
        migrationBlockedReason: blockedOutbox.lastError,
      });
      writeTransaction.objectStore(OUTBOX_STORE_NAME).put(blockedOutbox);
      await done;
      return { outbox: blockedOutbox, blocked: true };
    }

    const mutations = convertLegacyPendingSnapshotToMutations(legacy, remoteProfile) || [];
    const migratedAt = Date.now();
    const compacted = compactMemoryMutations([...(existing?.mutations || []), ...mutations]);
    try {
      validateMemoryMutations(compacted);
    } catch (error) {
      const blockedOutbox: MemoryMutationOutbox = {
        userId,
        expectedRevision: Math.max(0, remoteRevision),
        mutations: existing?.mutations || [],
        sequence: (existing?.sequence || 0) + 1,
        savedAt: Date.now(),
        language: legacy.language || 'en',
        legacySnapshotBlocked: true,
        inFlightBatch: existing?.inFlightBatch,
        lastError: error instanceof Error ? error.message : 'Legacy pending snapshot is too large to convert safely.',
      };
      const writeTransaction = database.transaction([LEGACY_STORE_NAME, OUTBOX_STORE_NAME], 'readwrite');
      const done = transactionDone(writeTransaction);
      writeTransaction.objectStore(LEGACY_STORE_NAME).put({
        ...legacy,
        migrationBlockedReason: blockedOutbox.lastError,
      });
      writeTransaction.objectStore(OUTBOX_STORE_NAME).put(blockedOutbox);
      await done;
      return { outbox: blockedOutbox, blocked: true };
    }
    const nextOutbox: MemoryMutationOutbox = {
      userId,
      expectedRevision: Math.max(0, legacy.baseRevision),
      mutations: compacted,
      sequence: (existing?.sequence || 0) + 1,
      savedAt: migratedAt,
      language: legacy.language || 'en',
      legacySnapshotMigratedAt: migratedAt,
      inFlightBatch: existing?.inFlightBatch,
    };
    const writeTransaction = database.transaction([LEGACY_STORE_NAME, OUTBOX_STORE_NAME], 'readwrite');
    const done = transactionDone(writeTransaction);
    writeTransaction.objectStore(LEGACY_STORE_NAME).put({
      ...legacy,
      migratedToMutationOutboxAt: migratedAt,
    });
    writeTransaction.objectStore(OUTBOX_STORE_NAME).put(nextOutbox);
    await done;
    return { outbox: nextOutbox, blocked: false };
  } finally {
    database.close();
  }
};
