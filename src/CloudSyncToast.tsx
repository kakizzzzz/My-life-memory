import React from 'react';
import {
  getCloudSyncStatus,
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
    conflict: 'Another device changed this archive. This device copy was kept without overwriting cloud data.',
  },
  zh: {
    local: '已在本机保存',
    syncing: '正在同步云端…',
    synced: '已同步',
    error: '云端同步失败，本机副本已保留',
    conflict: '检测到其他设备更新，本机修改已保留，暂未覆盖云端',
  },
  ko: {
    local: '이 기기에 저장됨',
    syncing: '클라우드에 동기화 중…',
    synced: '동기화됨',
    error: '클라우드 동기화에 실패했습니다. 기기 사본은 보관되었습니다.',
    conflict: '다른 기기의 변경이 감지되어 이 기기 사본을 보관하고 클라우드는 덮어쓰지 않았습니다.',
  },
};

export function CloudSyncToast() {
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

  return (
    <div
      className="app-feedback-toast pointer-events-none fixed left-1/2 z-[3200] max-w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full px-4 text-center text-[13px] font-medium"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 7.5rem)' }}
      role="status"
      aria-live="polite"
    >
      {languageCopy[status.phase]}
    </div>
  );
}
