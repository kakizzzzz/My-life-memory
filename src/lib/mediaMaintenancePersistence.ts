const MEDIA_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MEDIA_SCAN_STORAGE_KEY_PREFIX = 'my-life-memory-media-scan-v1:';
const MEMORY_TRASH_PURGE_STORAGE_KEY_PREFIX = 'my-life-memory-trash-purge-v1:';

const normalizedAccountKey = (account: string) => (
  encodeURIComponent(account.trim().toLowerCase())
);

const getMediaScanStorageKey = (account: string) => (
  `${MEDIA_SCAN_STORAGE_KEY_PREFIX}${normalizedAccountKey(account)}`
);

const getMemoryTrashPurgeStorageKey = (account: string) => (
  `${MEMORY_TRASH_PURGE_STORAGE_KEY_PREFIX}${normalizedAccountKey(account)}`
);

export const isMediaScanDue = (account: string) => {
  if (typeof window === 'undefined' || !account) return false;
  const previousScan = Number(window.localStorage.getItem(getMediaScanStorageKey(account)) || 0);
  return !Number.isFinite(previousScan) || Date.now() - previousScan >= MEDIA_SCAN_INTERVAL_MS;
};

export const markMediaScanComplete = (account: string) => {
  if (typeof window === 'undefined' || !account) return;
  try {
    window.localStorage.setItem(getMediaScanStorageKey(account), String(Date.now()));
  } catch {
    // A future focus or online event can safely retry the maintenance scan.
  }
};

export const claimDailyMemoryTrashPurge = (account: string) => {
  if (typeof window === 'undefined' || !account) return false;
  const storageKey = getMemoryTrashPurgeStorageKey(account);
  const now = Date.now();
  try {
    const previousAttempt = Number(window.localStorage.getItem(storageKey) || 0);
    if (Number.isFinite(previousAttempt) && now - previousAttempt < MEDIA_SCAN_INTERVAL_MS) return false;
    window.localStorage.setItem(storageKey, String(now));
    return true;
  } catch {
    return false;
  }
};

export const clearMediaMaintenanceLocalState = (account: string) => {
  if (typeof window === 'undefined' || !account) return;
  try {
    window.localStorage.removeItem(getMediaScanStorageKey(account));
    window.localStorage.removeItem(getMemoryTrashPurgeStorageKey(account));
  } catch {
    // The cloud account is already gone; local maintenance markers are best effort.
  }
};
