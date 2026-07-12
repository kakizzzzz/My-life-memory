import React from 'react';
import {
  cleanupUnreferencedStorageImages,
  isSupabaseMediaEnabled,
  MEDIA_BUCKET,
  retryPendingImageDeletions,
  warmStorageImageUrls,
  type StoredImageMetadata,
} from '../lib/mediaStorage';
import {
  loadProtectedMemoryMediaPaths,
  purgeExpiredMemoryTrash,
} from '../lib/memoryRepository';
import { readPendingMemoryMediaPaths } from '../lib/memoryOutbox';
import { getCloudSession } from '../lib/cloudBackend';
import {
  getStoredImagesFromNote,
  uniqueStoredImages,
} from '../lib/noteHtmlUtils';
import { migrateInlineMediaToStorage } from '../lib/mediaMigration';
import { getCloudSyncStatus, subscribeCloudSyncStatus } from '../lib/cloudSyncStatus';
import type { ProfileConflictData, StarData, UserProfile } from '../types/app';

const MEDIA_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MEDIA_SCAN_STORAGE_KEY_PREFIX = 'my-life-memory-media-scan-v1:';
const MEMORY_TRASH_PURGE_STORAGE_KEY_PREFIX = 'my-life-memory-trash-purge-v1:';

const getMediaScanStorageKey = (account: string) => (
  `${MEDIA_SCAN_STORAGE_KEY_PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`
);

const isMediaScanDue = (account: string) => {
  if (typeof window === 'undefined' || !account) return false;
  const previousScan = Number(window.localStorage.getItem(getMediaScanStorageKey(account)) || 0);
  return !Number.isFinite(previousScan) || Date.now() - previousScan >= MEDIA_SCAN_INTERVAL_MS;
};

const markMediaScanComplete = (account: string) => {
  if (typeof window === 'undefined' || !account) return;
  try {
    window.localStorage.setItem(getMediaScanStorageKey(account), String(Date.now()));
  } catch {
    // A future focus/online event can safely retry the maintenance scan.
  }
};

const claimDailyMemoryTrashPurge = (account: string) => {
  if (typeof window === 'undefined' || !account) return false;
  const storageKey = `${MEMORY_TRASH_PURGE_STORAGE_KEY_PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`;
  const now = Date.now();
  try {
    const previousAttempt = Number(window.localStorage.getItem(storageKey) || 0);
    if (Number.isFinite(previousAttempt) && now - previousAttempt < MEDIA_SCAN_INTERVAL_MS) return false;
    // Claim before the request so focus/online retries cannot call the RPC more
    // than once per day, even when the request itself fails.
    window.localStorage.setItem(storageKey, String(now));
    return true;
  } catch {
    return false;
  }
};

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
  const maintenanceInFlightRef = React.useRef(false);
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
  const getProtectedStoredMedia = React.useCallback(async () => {
    const session = await getCloudSession();
    const [cloudPaths, pendingPaths] = await Promise.all([
      loadProtectedMemoryMediaPaths(),
      session?.user ? readPendingMemoryMediaPaths(session.user.id) : Promise.resolve([]),
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
    const metadataList = getReferencedStoredMedia();

    void warmStorageImageUrls(metadataList).then(() => {
      if (isMounted) onMediaReady();
    });

    return () => {
      isMounted = false;
    };
  }, [getReferencedStoredMedia, isSignedIn, onMediaReady, profile.account]);

  React.useEffect(() => {
    if (!isSupabaseMediaEnabled || !isSignedIn) return;

    const retryDeletes = () => {
      void getProtectedStoredMedia()
        .then(protectedMedia => retryPendingImageDeletions(uniqueStoredImages([
          ...getReferencedStoredMedia(),
          ...protectedMedia,
        ])))
        .catch(error => console.warn('Protected media references could not be loaded:', error));
    };

    retryDeletes();
    window.addEventListener('online', retryDeletes);
    window.addEventListener('focus', retryDeletes);

    return () => {
      window.removeEventListener('online', retryDeletes);
      window.removeEventListener('focus', retryDeletes);
    };
  }, [getProtectedStoredMedia, getReferencedStoredMedia, isSignedIn, profile.account]);

  React.useEffect(() => {
    if (!isSupabaseMediaEnabled || !isSignedIn) return;

    const runMaintenance = async () => {
      if (maintenanceInFlightRef.current) return;
      maintenanceInFlightRef.current = true;
      const sourceProfile = latestProfileRef.current;
      const sourceStars = latestStarsRef.current;
      try {
        const migrated = await migrateInlineMediaToStorage(sourceProfile, sourceStars);
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
          await purgeExpiredMemoryTrash();
        }

        const latestProfile = latestProfileRef.current;
        const latestStars = latestStarsRef.current;
        const protectedMedia = await getProtectedStoredMedia();
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
          await retryPendingImageDeletions(referencedMedia);
          if (isMediaScanDue(sourceProfile.account)) {
            await cleanupUnreferencedStorageImages(referencedMedia);
            markMediaScanComplete(sourceProfile.account);
          }
        }
      } catch (error) {
        console.warn('Cloud media maintenance could not finish:', error);
      } finally {
        maintenanceInFlightRef.current = false;
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
  }, [getProtectedStoredMedia, isSignedIn, profile.account, profileConflicts, setProfile, setStars]);
};
