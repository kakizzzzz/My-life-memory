import React from 'react';
import {
  getCloudSyncStatus,
  resolveCloudConflict,
  setCloudSyncStatus,
  subscribeCloudSyncStatus,
  type CloudSyncPhase,
} from './lib/cloudSyncStatus';

const COPY: Record<string, Record<Exclude<CloudSyncPhase, 'idle'>, string>> = {
  en: {
    local: 'Saved on this device',
    syncing: 'Syncing to cloud…',
    synced: 'Synced',
    error: 'Cloud sync failed. A local copy was kept.',
    conflict: 'Cloud content changed in another page or device. This copy was kept without overwriting it.',
  },
  zh: {
    local: '已在本机保存',
    syncing: '正在同步云端…',
    synced: '已同步',
    error: '云端同步失败，本机副本已保留',
    conflict: '检测到其他页面或设备更新，本机修改已保留，暂未覆盖云端',
  },
  ko: {
    local: '이 기기에 저장됨',
    syncing: '클라우드에 동기화 중…',
    synced: '동기화됨',
    error: '클라우드 동기화에 실패했습니다. 기기 사본은 보관되었습니다.',
    conflict: '다른 페이지 또는 기기의 변경이 감지되어 이 사본을 보관하고 클라우드는 덮어쓰지 않았습니다.',
  },
};

const CONFLICT_ACTION_COPY: Record<string, { merge: string; local: string; cloud: string }> = {
  en: { merge: 'Merge safely', local: 'Keep this device', cloud: 'Load cloud copy' },
  zh: { merge: '安全合并', local: '保留本机版本', cloud: '载入云端版本' },
  ko: { merge: '안전하게 병합', local: '이 기기 유지', cloud: '클라우드 불러오기' },
};

export function CloudSyncToast() {
  const [isResolving, setIsResolving] = React.useState(false);
  const status = React.useSyncExternalStore(
    subscribeCloudSyncStatus,
    getCloudSyncStatus,
    getCloudSyncStatus
  );

  React.useEffect(() => {
    if (status.phase !== 'synced') return;
    const timer = window.setTimeout(() => {
      if (getCloudSyncStatus().updatedAt === status.updatedAt) {
        setCloudSyncStatus('idle', status.language);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [status.language, status.phase, status.updatedAt]);

  if (status.phase === 'idle') return null;
  const languageCopy = COPY[status.language] || COPY.en;
  const actionCopy = CONFLICT_ACTION_COPY[status.language] || CONFLICT_ACTION_COPY.en;

  const handleResolve = async (strategy: 'merge' | 'local' | 'cloud') => {
    if (isResolving) return;
    setIsResolving(true);
    try {
      await resolveCloudConflict(strategy);
    } catch (error) {
      console.error('Could not resolve cloud conflict:', error);
      setCloudSyncStatus('conflict', status.language);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div
      className={`app-feedback-toast fixed left-1/2 z-[3200] max-w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 px-4 text-center text-[13px] font-medium ${status.phase === 'conflict' ? 'pointer-events-auto rounded-2xl py-2.5' : 'pointer-events-none rounded-full'}`}
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 7.5rem)' }}
      role="status"
      aria-live="polite"
    >
      <div>{languageCopy[status.phase]}</div>
      {status.phase === 'conflict' && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={isResolving}
            onClick={() => void handleResolve('merge')}
            className="rounded-full bg-black/20 px-3 py-1 text-[12px] disabled:opacity-50"
          >
            {actionCopy.merge}
          </button>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => void handleResolve('local')}
            className="rounded-full bg-black/15 px-3 py-1 text-[12px] disabled:opacity-50"
          >
            {actionCopy.local}
          </button>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => void handleResolve('cloud')}
            className="rounded-full bg-white/45 px-3 py-1 text-[12px] disabled:opacity-50"
          >
            {actionCopy.cloud}
          </button>
        </div>
      )}
    </div>
  );
}
