import React from 'react';
import { sanitizeRichHtml } from '../lib/htmlSanitizer';
import {
  captureMediaAccountScope,
  dehydrateStorageMediaHtml,
  discardUploadedImageForScope,
  isSupabaseMediaEnabled,
  requestCloudMediaMaintenance,
  uploadImageToStorage,
  type StoredImageMetadata,
} from '../lib/mediaStorage';
import {
  compressImageFileToDataUrl,
  dataUrlToFile,
  readPhotoGpsCoordinates,
} from '../lib/photoUtils';
import { createClientId } from '../lib/generalUtils';
import {
  escapeHtml,
  imageToReaderHtml,
  readerEditableTailHtml,
} from '../lib/noteHtmlUtils';
import type { NoteData, StarData } from '../types/app';
import { useAsyncScope } from './useAsyncScope';

type PhotoLocationImportCopy = {
  photoLocationLoading: string;
  photoLocationNoGps: string;
  photoGpsNoteTitle: string;
  noteImageAlt: string;
  removeImage: string;
  photoLocationCreated: string;
  photoLocationFailed: string;
};

export const usePhotoLocationImport = ({
  accountScopeKey,
  copy,
  addStarAtLatLng,
  onCreated,
}: {
  accountScopeKey: string;
  copy: PhotoLocationImportCopy;
  addStarAtLatLng: (lat: number, lng: number, starData?: Partial<StarData>) => void;
  onCreated: (starId: string, coordinates: [number, number]) => void;
}) => {
  const { captureScope, isScopeCurrent } = useAsyncScope(accountScopeKey);
  const [isReadingPhotoLocation, setIsReadingPhotoLocation] = React.useState(false);
  const [photoLocationStatus, setPhotoLocationStatus] = React.useState('');
  const photoLocationStatusTimerRef = React.useRef<number | null>(null);
  const importRequestRef = React.useRef(0);

  const showPhotoLocationStatus = React.useCallback((message: string, durationMs = 500) => {
    if (photoLocationStatusTimerRef.current !== null) {
      window.clearTimeout(photoLocationStatusTimerRef.current);
      photoLocationStatusTimerRef.current = null;
    }
    setPhotoLocationStatus(message);
    if (durationMs > 0) {
      photoLocationStatusTimerRef.current = window.setTimeout(() => {
        setPhotoLocationStatus('');
        photoLocationStatusTimerRef.current = null;
      }, durationMs);
    }
  }, []);

  React.useEffect(() => () => {
    if (photoLocationStatusTimerRef.current !== null) {
      window.clearTimeout(photoLocationStatusTimerRef.current);
    }
  }, []);

  React.useEffect(() => {
    importRequestRef.current += 1;
    if (photoLocationStatusTimerRef.current !== null) {
      window.clearTimeout(photoLocationStatusTimerRef.current);
      photoLocationStatusTimerRef.current = null;
    }
    setIsReadingPhotoLocation(false);
    setPhotoLocationStatus('');
  }, [accountScopeKey]);

  const handlePhotoLocationInput = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const looksLikeImage = file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
    if (!looksLikeImage) return;
    if (isReadingPhotoLocation) return;

    const runScope = captureScope();
    const requestId = importRequestRef.current + 1;
    importRequestRef.current = requestId;
    const isCurrent = () => (
      importRequestRef.current === requestId && isScopeCurrent(runScope)
    );

    setIsReadingPhotoLocation(true);
    showPhotoLocationStatus(copy.photoLocationLoading, 0);

    try {
      const accountScope = isSupabaseMediaEnabled
        ? await captureMediaAccountScope()
        : null;
      if (!isCurrent()) return;
      const coordinates = await readPhotoGpsCoordinates(file);
      if (!isCurrent()) return;
      if (!coordinates) {
        showPhotoLocationStatus(copy.photoLocationNoGps, 1800);
        return;
      }

      const [lat, lng] = coordinates;
      const timestamp = Date.now();
      const starId = createClientId();
      const noteId = createClientId();
      const imageUrl = await compressImageFileToDataUrl(file);
      if (!isCurrent()) return;
      let imageHtml = imageToReaderHtml(imageUrl, copy.noteImageAlt, copy.removeImage);
      let imageMetadata: StoredImageMetadata | undefined;

      if (isSupabaseMediaEnabled && accountScope) {
        try {
          const compressedFile = await dataUrlToFile(imageUrl, file.name || `${timestamp}.jpg`);
          if (!isCurrent()) return;
          const uploaded = await uploadImageToStorage(compressedFile, {
            noteId,
            folder: 'notes',
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
            imageMetadata = uploaded.metadata;
            imageHtml = imageToReaderHtml(uploaded.src, copy.noteImageAlt, copy.removeImage, uploaded.metadata);
          }
        } catch (error) {
          if (!isCurrent()) return;
          console.warn('Supabase Storage photo GPS upload failed, using data URL fallback:', error);
          requestCloudMediaMaintenance();
        }
      }

      const contentHtml = sanitizeRichHtml(dehydrateStorageMediaHtml(`${imageHtml}${readerEditableTailHtml}`));
      const title = copy.photoGpsNoteTitle;
      const note: NoteData = {
        id: noteId,
        title,
        titleHtml: sanitizeRichHtml(escapeHtml(title)),
        content: '',
        contentHtml,
        images: imageMetadata ? [imageMetadata] : undefined,
        fontSize: 18,
        titleFontSize: 18,
        createdAt: timestamp,
        updatedAt: timestamp,
        color: '#D2936D',
      };

      if (!isCurrent()) {
        if (imageMetadata && accountScope) {
          await discardUploadedImageForScope(imageMetadata, accountScope);
        }
        return;
      }
      addStarAtLatLng(lat, lng, {
        id: starId,
        createdAt: timestamp,
        color: '#EDC727',
        notes: [note],
      });
      onCreated(starId, [lat, lng]);
      showPhotoLocationStatus(copy.photoLocationCreated, 500);
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Could not create star from photo GPS:', error);
      showPhotoLocationStatus(copy.photoLocationFailed, 500);
    } finally {
      if (isCurrent()) setIsReadingPhotoLocation(false);
    }
  }, [
    addStarAtLatLng,
    captureScope,
    copy.noteImageAlt,
    copy.photoGpsNoteTitle,
    copy.photoLocationCreated,
    copy.photoLocationFailed,
    copy.photoLocationLoading,
    copy.photoLocationNoGps,
    copy.removeImage,
    isReadingPhotoLocation,
    isScopeCurrent,
    onCreated,
    showPhotoLocationStatus,
  ]);

  return {
    isReadingPhotoLocation,
    photoLocationStatus,
    handlePhotoLocationInput,
  };
};
