import React from 'react';
import {
  getCloudSyncStatus,
  resolveCloudConflict,
  setCloudSyncStatus,
  subscribeCloudSyncStatus,
  type CloudSyncPhase,
} from './lib/cloudSyncStatus';
import type { MemorySyncIssueKind } from './lib/memorySyncErrors';

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

const ERROR_COPY: Record<string, Record<MemorySyncIssueKind, string>> = {
  en: {
    network: 'Network unavailable. A local copy was kept.',
    validation: 'One local change cannot sync yet. A local copy was kept.',
    authorization: 'Cloud access expired. A local copy was kept; please sign in again.',
    storage: 'The local sync queue is temporarily unavailable. Your open copy was kept.',
    server: 'Cloud sync is temporarily unavailable. A local copy was kept.',
    unknown: 'Cloud sync failed. A local copy was kept.',
  },
  zh: {
    network: '网络暂不可用，本机副本已保留',
    validation: '一项本机修改暂不能同步，本机副本已保留',
    authorization: '云端权限已失效，本机副本已保留，请重新登录',
    storage: '本机同步队列暂不可用，当前内容仍保留',
    server: '云端服务暂不可用，本机副本已保留',
    unknown: '云端同步失败，本机副本已保留',
  },
  ko: {
    network: '네트워크를 사용할 수 없어 기기 사본을 보관했습니다.',
    validation: '한 변경 사항을 아직 동기화할 수 없어 기기 사본을 보관했습니다.',
    authorization: '클라우드 권한이 만료되었습니다. 기기 사본을 보관했으니 다시 로그인해 주세요.',
    storage: '로컬 동기화 대기열을 사용할 수 없습니다. 현재 내용은 보관되었습니다.',
    server: '클라우드 동기화를 일시적으로 사용할 수 없습니다. 기기 사본은 보관되었습니다.',
    unknown: '클라우드 동기화에 실패했습니다. 기기 사본은 보관되었습니다.',
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
  const errorCopy = ERROR_COPY[status.language] || ERROR_COPY.en;
  const actionCopy = CONFLICT_ACTION_COPY[status.language] || CONFLICT_ACTION_COPY.en;
  const message = status.phase === 'error'
    ? errorCopy[status.issue || 'unknown']
    : languageCopy[status.phase];

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
      <div>{message}</div>
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
