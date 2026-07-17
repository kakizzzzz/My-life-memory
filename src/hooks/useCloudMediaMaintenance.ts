import React from 'react';
import {
  cleanupUnreferencedStorageImages,
  captureMediaAccountScope,
  isSupabaseMediaEnabled,
  MEDIA_BUCKET,
  retryPendingImageDeletions,
  STORAGE_IMAGE_URL_REFRESH_INTERVAL_MS,
  warmStorageImageUrls,
  type StoredImageMetadata,
} from '../lib/mediaStorage';
import {
  loadProtectedMemoryMediaPaths,
  purgeExpiredMemoryTrash,
} from '../lib/memoryRepository';
import { readPendingMemoryMediaPaths } from '../lib/memoryOutbox';
import { createSessionScopedSupabaseClient } from '../lib/supabaseClient';
import {
  getStoredImagesFromNote,
  uniqueStoredImages,
} from '../lib/noteHtmlUtils';
import { migrateInlineMediaToStorage } from '../lib/mediaMigration';
import { getCloudSyncStatus, subscribeCloudSyncStatus } from '../lib/cloudSyncStatus';
import {
  claimDailyMemoryTrashPurge,
  isMediaScanDue,
  markMediaScanComplete,
} from '../lib/mediaMaintenancePersistence';
import { useAsyncScope, type AsyncScopeToken } from './useAsyncScope';
import type { ProfileConflictData, StarData, UserProfile } from '../types/app';

export const useCloudMediaMaintenance = ({
  isSignedIn,
  profile,
  profileConflicts,
  stars,
  setProfile,
  setStars,
  onMediaReady,
}: {
  isSignedIn: boolean;
  profile: UserProfile;
  profileConflicts: ProfileConflictData[];
  stars: StarData[];
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
  setStars: React.Dispatch<React.SetStateAction<StarData[]>>;
  onMediaReady: () => void;
}) => {
  const accountScopeKey = `${isSignedIn ? 'signed-in' : 'signed-out'}:${profile.account.trim().toLowerCase()}`;
  const { captureScope, isScopeCurrent } = useAsyncScope(accountScopeKey);
  const maintenanceInFlightRef = React.useRef<AsyncScopeToken | null>(null);
  const latestProfileRef = React.useRef(profile);
  const latestStarsRef = React.useRef(stars);
  latestProfileRef.current = profile;
  latestStarsRef.current = stars;
  const getReferencedStoredMedia = React.useCallback(() => (
    uniqueStoredImages([
      profile.avatarImage,
      ...profileConflicts.map(conflict => conflict.avatarImage),
      ...stars.flatMap(star => (
        (star.notes || []).flatMap(note => getStoredImagesFromNote(note))
      )),
    ].filter((metadata): metadata is StoredImageMetadata => Boolean(metadata)))
  ), [profile.avatarImage, profileConflicts, stars]);
  const getProtectedStoredMedia = React.useCallback(async (
    accountScope: NonNullable<Awaited<ReturnType<typeof captureMediaAccountScope>>>,
  ) => {
    const scopedClient = createSessionScopedSupabaseClient(accountScope.accessToken);
    if (!scopedClient) return [];
    const [cloudPaths, pendingPaths] = await Promise.all([
      loadProtectedMemoryMediaPaths(scopedClient),
      readPendingMemoryMediaPaths(accountScope.userId),
    ]);
    const paths = [...new Set([...cloudPaths, ...pendingPaths])];
    return paths.map(path => ({
      provider: 'supabase' as const,
      bucket: MEDIA_BUCKET,
      key: path,
      path,
      mimeType: 'image/jpeg',
      size: 0,
      createdAt: 0,
    }));
  }, []);

  React.useEffect(() => {
    if (!isSupabaseMediaEnabled || !isSignedIn) return;

    let isMounted = true;
    const refreshSignedImageUrls = () => {
      const metadataList = getReferencedStoredMedia();
      if (metadataList.length === 0) return;

      void warmStorageImageUrls(metadataList, {
        onBatchReady: () => {
          if (isMounted) onMediaReady();
        },
      }).catch(error => {
        console.warn('Signed media URLs could not be refreshed:', error);
      });
    };
    const refreshVisibleImageUrls = () => {
      if (document.visibilityState === 'visible') refreshSignedImageUrls();
    };

    refreshSignedImageUrls();
    const intervalId = window.setInterval(
      refreshSignedImageUrls,
      STORAGE_IMAGE_URL_REFRESH_INTERVAL_MS,
    );
    window.addEventListener('focus', refreshSignedImageUrls);
    document.addEventListener('visibilitychange', refreshVisibleImageUrls);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshSignedImageUrls);
      document.removeEventListener('visibilitychange', refreshVisibleImageUrls);
    };
  }, [getReferencedStoredMedia, isSignedIn, onMediaReady, profile.account]);

  React.useEffect(() => {
    if (!isSupabaseMediaEnabled || !isSignedIn) return;

    const retryDeletes = () => {
      const runScope = captureScope();
      void captureMediaAccountScope()
        .then(async accountScope => {
          if (!accountScope || !isScopeCurrent(runScope)) return;
          const protectedMedia = await getProtectedStoredMedia(accountScope);
          if (!isScopeCurrent(runScope)) return;
          await retryPendingImageDeletions(uniqueStoredImages([
            ...getReferencedStoredMedia(),
            ...protectedMedia,
          ]), {
            accountScope,
            allowDeferredDeletes: getCloudSyncStatus().phase === 'synced',
          });
        })
        .catch(error => console.warn('Protected media references could not be loaded:', error));
    };

    retryDeletes();
    window.addEventListener('online', retryDeletes);
    window.addEventListener('focus', retryDeletes);

    return () => {
      window.removeEventListener('online', retryDeletes);
      window.removeEventListener('focus', retryDeletes);
    };
  }, [captureScope, getProtectedStoredMedia, getReferencedStoredMedia, isScopeCurrent, isSignedIn, profile.account]);

  React.useEffect(() => {
    if (!isSupabaseMediaEnabled || !isSignedIn) return;

    const runMaintenance = async () => {
      const runScope = captureScope();
      const activeRun = maintenanceInFlightRef.current;
      if (
        activeRun
        && activeRun.key === runScope.key
        && activeRun.generation === runScope.generation
      ) return;
      maintenanceInFlightRef.current = runScope;
      const sourceProfile = latestProfileRef.current;
      const sourceStars = latestStarsRef.current;
      try {
        const accountScope = await captureMediaAccountScope();
        if (!accountScope || !isScopeCurrent(runScope)) return;
        const scopedClient = createSessionScopedSupabaseClient(accountScope.accessToken);
        if (!scopedClient) return;
        const migrated = await migrateInlineMediaToStorage(sourceProfile, sourceStars, {
          accountScope,
          isCurrent: () => isScopeCurrent(runScope),
        });
        if (migrated.aborted || !isScopeCurrent(runScope)) return;
        if (migrated.changed) {
          setProfile(current => (
            current.account === sourceProfile.account && current.avatarUrl === sourceProfile.avatarUrl
              ? migrated.profile
              : current
          ));
          setStars(current => current.map(currentStar => {
            const sourceStar = sourceStars.find(star => star.id === currentStar.id);
            const migratedStar = migrated.stars.find(star => star.id === currentStar.id);
            if (!sourceStar || !migratedStar) return currentStar;
            return {
              ...currentStar,
              notes: (currentStar.notes || []).map(currentNote => {
                const sourceNote = sourceStar.notes?.find(note => note.id === currentNote.id);
                const migratedNote = migratedStar.notes?.find(note => note.id === currentNote.id);
                return sourceNote && migratedNote && currentNote.contentHtml === sourceNote.contentHtml
                  ? migratedNote
                  : currentNote;
              }),
            };
          }));
        }

        const canPurgeExpiredTrash = !migrated.changed && getCloudSyncStatus().phase === 'synced';
        if (canPurgeExpiredTrash && claimDailyMemoryTrashPurge(sourceProfile.account)) {
          await purgeExpiredMemoryTrash(scopedClient);
          if (!isScopeCurrent(runScope)) return;
        }

        const latestProfile = latestProfileRef.current;
        const latestStars = latestStarsRef.current;
        const protectedMedia = await getProtectedStoredMedia(accountScope);
        if (!isScopeCurrent(runScope)) return;
        const referencedMedia = uniqueStoredImages([
          migrated.profile.avatarImage,
          latestProfile.avatarImage,
          ...profileConflicts.map(conflict => conflict.avatarImage),
          ...migrated.stars.flatMap(star => (
            (star.notes || []).flatMap(note => getStoredImagesFromNote(note))
          )),
          ...latestStars.flatMap(star => (
            (star.notes || []).flatMap(note => getStoredImagesFromNote(note))
          )),
          ...protectedMedia,
        ].filter((metadata): metadata is StoredImageMetadata => Boolean(metadata)));
        const canCleanCloudMedia = !migrated.changed && getCloudSyncStatus().phase === 'synced';
        if (canCleanCloudMedia) {
          await retryPendingImageDeletions(referencedMedia, {
            accountScope,
            allowDeferredDeletes: true,
          });
          if (!isScopeCurrent(runScope)) return;
          if (isMediaScanDue(sourceProfile.account)) {
            await cleanupUnreferencedStorageImages(referencedMedia, undefined, accountScope);
            if (!isScopeCurrent(runScope)) return;
            markMediaScanComplete(sourceProfile.account);
          }
        }
      } catch (error) {
        console.warn('Cloud media maintenance could not finish:', error);
      } finally {
        const activeRun = maintenanceInFlightRef.current;
        if (
          activeRun?.key === runScope.key
          && activeRun.generation === runScope.generation
        ) maintenanceInFlightRef.current = null;
      }
    };

    const requestMaintenance = () => void runMaintenance();
    requestMaintenance();
    window.addEventListener('online', requestMaintenance);
    window.addEventListener('focus', requestMaintenance);
    window.addEventListener('mlm:media-maintenance', requestMaintenance);
    const unsubscribeCloudSync = subscribeCloudSyncStatus(() => {
      if (getCloudSyncStatus().phase === 'synced') requestMaintenance();
    });
    return () => {
      window.removeEventListener('online', requestMaintenance);
      window.removeEventListener('focus', requestMaintenance);
      window.removeEventListener('mlm:media-maintenance', requestMaintenance);
      unsubscribeCloudSync();
    };
  }, [captureScope, getProtectedStoredMedia, isScopeCurrent, isSignedIn, profile.account, profileConflicts, setProfile, setStars]);
};
