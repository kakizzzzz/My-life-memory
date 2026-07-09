import React from 'react';
import {
  isSupabaseMediaEnabled,
  retryPendingImageDeletions,
  warmStorageImageUrls,
  type StoredImageMetadata,
} from '../lib/mediaStorage';
import {
  getStoredImagesFromNote,
  uniqueStoredImages,
} from '../lib/noteHtmlUtils';
import type { StarData, UserProfile } from '../types/app';

export const useCloudMediaMaintenance = ({
  isSignedIn,
  profile,
  stars,
  onMediaReady,
}: {
  isSignedIn: boolean;
  profile: UserProfile;
  stars: StarData[];
  onMediaReady: () => void;
}) => {
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
};
