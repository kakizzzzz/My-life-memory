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
import { getCloudSyncStatus } from '../lib/cloudSyncStatus';
import type { StarData, UserProfile } from '../types/app';

export const useCloudMediaMaintenance = ({
  isSignedIn,
  profile,
  stars,
  setProfile,
  setStars,
  onMediaReady,
}: {
  isSignedIn: boolean;
  profile: UserProfile;
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
      ...stars.flatMap(star => (
        (star.notes || []).flatMap(note => getStoredImagesFromNote(note))
      )),
    ].filter((metadata): metadata is StoredImageMetadata => Boolean(metadata)))
  ), [profile.avatarImage, stars]);

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
      void retryPendingImageDeletions();
    };

    retryDeletes();
    window.addEventListener('online', retryDeletes);
    window.addEventListener('focus', retryDeletes);

    return () => {
      window.removeEventListener('online', retryDeletes);
      window.removeEventListener('focus', retryDeletes);
    };
  }, [isSignedIn, profile.account]);

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
          ...migrated.stars.flatMap(star => (
            (star.notes || []).flatMap(note => getStoredImagesFromNote(note))
          )),
          ...latestStars.flatMap(star => (
            (star.notes || []).flatMap(note => getStoredImagesFromNote(note))
          )),
        ].filter((metadata): metadata is StoredImageMetadata => Boolean(metadata)));
        if (getCloudSyncStatus().phase !== 'conflict') {
          await cleanupUnreferencedStorageImages(referencedMedia);
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
    return () => {
      window.removeEventListener('online', requestMaintenance);
      window.removeEventListener('focus', requestMaintenance);
      window.removeEventListener('mlm:media-maintenance', requestMaintenance);
    };
  }, [isSignedIn, profile.account, setProfile, setStars]);
};
