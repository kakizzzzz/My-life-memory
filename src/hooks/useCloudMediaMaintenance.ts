import React from 'react';
import {
  cleanupUnreferencedStorageImages,
  isSupabaseMediaEnabled,
  retryPendingImageDeletions,
  warmStorageImageUrls,
  type StoredImageMetadata,
} from '../lib/mediaStorage';
import {
  getStoredImagesFromNote,
  uniqueStoredImages,
} from '../lib/noteHtmlUtils';
import { migrateInlineMediaToStorage } from '../lib/mediaMigration';
import { getCloudSyncStatus, subscribeCloudSyncStatus } from '../lib/cloudSyncStatus';
import type { ProfileConflictData, StarData, UserProfile } from '../types/app';

const MEDIA_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MEDIA_SCAN_STORAGE_KEY_PREFIX = 'my-life-memory-media-scan-v1:';

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
      void retryPendingImageDeletions(getReferencedStoredMedia());
    };

    retryDeletes();
    window.addEventListener('online', retryDeletes);
    window.addEventListener('focus', retryDeletes);

    return () => {
      window.removeEventListener('online', retryDeletes);
      window.removeEventListener('focus', retryDeletes);
    };
  }, [getReferencedStoredMedia, isSignedIn, profile.account]);

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

        const latestProfile = latestProfileRef.current;
        const latestStars = latestStarsRef.current;
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
  }, [isSignedIn, profile.account, profileConflicts, setProfile, setStars]);
};
