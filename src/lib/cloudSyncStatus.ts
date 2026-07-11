export type CloudSyncPhase = 'idle' | 'local' | 'syncing' | 'synced' | 'error' | 'conflict';

export type CloudSyncStatus = {
  phase: CloudSyncPhase;
  language: string;
  updatedAt: number;
};

export type CloudConflictStrategy = 'local' | 'cloud';

let conflictResolver: ((strategy: CloudConflictStrategy) => Promise<void>) | null = null;

let currentStatus: CloudSyncStatus = {
  phase: 'idle',
  language: 'en',
  updatedAt: Date.now(),
};

const listeners = new Set<() => void>();

export const getCloudSyncStatus = () => currentStatus;

export const subscribeCloudSyncStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setCloudSyncStatus = (phase: CloudSyncPhase, language = currentStatus.language) => {
  currentStatus = {
    phase,
    language,
    updatedAt: Date.now(),
  };
  listeners.forEach(listener => listener());
};

export const registerCloudConflictResolver = (
  resolver: ((strategy: CloudConflictStrategy) => Promise<void>) | null
) => {
  conflictResolver = resolver;
};

export const resolveCloudConflict = async (strategy: CloudConflictStrategy) => {
  if (!conflictResolver) return;
  await conflictResolver(strategy);
};
