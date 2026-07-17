import React from 'react';
import {
  captureMediaAccountScope,
  discardUploadedImageForScope,
  scheduleImageDeletion,
  isSupabaseMediaEnabled,
  requestCloudMediaMaintenance,
  storagePlaceholderSrc,
  uploadImageToStorage,
  type StoredImageMetadata,
} from '../lib/mediaStorage';
import {
  compressImageFileToDataUrl,
  dataUrlToFile,
  getImageDownloadFileName,
} from '../lib/photoUtils';
import type { UploadedImage, UserProfile } from '../types/app';
import { useAsyncScope } from './useAsyncScope';

type NavigatorWithFileShare = Navigator & {
  canShare?: (data: { files?: File[]; title?: string }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
};

const downloadGalleryImageFallback = (href: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const useGalleryActions = ({
  accountScopeKey,
  profile,
  setProfile,
}: {
  accountScopeKey: string;
  profile: UserProfile;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>;
}) => {
  const { captureScope, isScopeCurrent } = useAsyncScope(accountScopeKey);
  const avatarRequestRef = React.useRef(0);
  const latestProfileRef = React.useRef(profile);
  latestProfileRef.current = profile;

  React.useEffect(() => {
    avatarRequestRef.current += 1;
  }, [accountScopeKey]);

  const handleAvatarInput = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const runScope = captureScope();
    const requestId = avatarRequestRef.current + 1;
    avatarRequestRef.current = requestId;
    const isCurrent = () => (
      avatarRequestRef.current === requestId && isScopeCurrent(runScope)
    );
    const accountScope = isSupabaseMediaEnabled
      ? await captureMediaAccountScope().catch(error => {
          console.warn('Could not capture the avatar upload session, using the local fallback:', error);
          return null;
        })
      : null;
    if (!isCurrent()) return;
    const imageUrl = await compressImageFileToDataUrl(file);
    if (!isCurrent()) return;
    let avatarUrl = imageUrl;
    let avatarImage: StoredImageMetadata | undefined;

    if (isSupabaseMediaEnabled && accountScope) {
      try {
        const compressedFile = await dataUrlToFile(imageUrl, `avatar-${Date.now()}.jpg`);
        if (!isCurrent()) return;
        const uploaded = await uploadImageToStorage(compressedFile, {
          folder: 'avatars',
          noteId: 'profile',
          fileName: compressedFile.name,
          accountScope: accountScope || undefined,
        });
        if (!isCurrent()) {
          if (uploaded.metadata && accountScope) {
            await discardUploadedImageForScope(uploaded.metadata, accountScope);
          }
          return;
        }
        if (uploaded.metadata) {
          avatarUrl = storagePlaceholderSrc(uploaded.metadata);
          avatarImage = uploaded.metadata;
        }
      } catch (error) {
        if (!isCurrent()) return;
        console.warn('Supabase Storage avatar upload failed, using data URL fallback:', error);
        requestCloudMediaMaintenance();
      }
    }

    if (!isCurrent()) {
      if (avatarImage && accountScope) {
        await discardUploadedImageForScope(avatarImage, accountScope);
      }
      return;
    }
    const previousAvatarImage = latestProfileRef.current.avatarImage;
    setProfile(prev => ({ ...prev, avatarUrl, avatarImage }));
    if (previousAvatarImage && previousAvatarImage.key !== avatarImage?.key) {
      void scheduleImageDeletion(previousAvatarImage);
    }
  }, [captureScope, isScopeCurrent, setProfile]);

  const downloadGalleryImage = React.useCallback(async (image: UploadedImage) => {
    let objectUrl: string | null = null;
    const fallbackFileName = getImageDownloadFileName(image.title);

    try {
      const response = await fetch(image.src);
      if (!response.ok) throw new Error('Could not fetch image.');

      const blob = await response.blob();
      const mimeType = blob.type || 'image/jpeg';
      const fileName = getImageDownloadFileName(image.title, mimeType);
      const file = new File([blob], fileName, { type: mimeType });
      const shareNavigator = navigator as NavigatorWithFileShare;

      if (shareNavigator.share && (!shareNavigator.canShare || shareNavigator.canShare({ files: [file], title: image.title }))) {
        await shareNavigator.share({ files: [file], title: image.title });
        return;
      }

      objectUrl = URL.createObjectURL(blob);
      downloadGalleryImageFallback(objectUrl, fileName);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Could not open native image save flow, falling back to download:', error);
        downloadGalleryImageFallback(image.src, fallbackFileName);
      }
    } finally {
      if (objectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }
  }, []);

  return {
    handleAvatarInput,
    downloadGalleryImage,
  };
};
