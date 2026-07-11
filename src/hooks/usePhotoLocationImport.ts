import React from 'react';
import { sanitizeRichHtml } from '../lib/htmlSanitizer';
import {
  dehydrateStorageMediaHtml,
  isSupabaseMediaEnabled,
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
  copy,
  addStarAtLatLng,
  onCreated,
}: {
  copy: PhotoLocationImportCopy;
  addStarAtLatLng: (lat: number, lng: number, starData?: Partial<StarData>) => void;
  onCreated: (starId: string, coordinates: [number, number]) => void;
}) => {
  const [isReadingPhotoLocation, setIsReadingPhotoLocation] = React.useState(false);
  const [photoLocationStatus, setPhotoLocationStatus] = React.useState('');
  const photoLocationStatusTimerRef = React.useRef<number | null>(null);

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

  const handlePhotoLocationInput = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const looksLikeImage = file.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name);
    if (!looksLikeImage) return;
    if (isReadingPhotoLocation) return;

    setIsReadingPhotoLocation(true);
    showPhotoLocationStatus(copy.photoLocationLoading, 0);

    try {
      const coordinates = await readPhotoGpsCoordinates(file);
      if (!coordinates) {
        showPhotoLocationStatus(copy.photoLocationNoGps, 1800);
        return;
      }

      const [lat, lng] = coordinates;
      const timestamp = Date.now();
      const starId = createClientId();
      const noteId = createClientId();
      const imageUrl = await compressImageFileToDataUrl(file);
      let imageHtml = imageToReaderHtml(imageUrl, copy.noteImageAlt, copy.removeImage);
      let imageMetadata: StoredImageMetadata | undefined;

      if (isSupabaseMediaEnabled) {
        try {
          const compressedFile = await dataUrlToFile(imageUrl, file.name || `${timestamp}.jpg`);
          const uploaded = await uploadImageToStorage(compressedFile, {
            noteId,
            folder: 'notes',
            fileName: compressedFile.name,
          });
          if (uploaded.metadata) {
            imageMetadata = uploaded.metadata;
            imageHtml = imageToReaderHtml(uploaded.src, copy.noteImageAlt, copy.removeImage, uploaded.metadata);
          }
        } catch (error) {
          console.warn('Supabase Storage photo GPS upload failed, using data URL fallback:', error);
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

      addStarAtLatLng(lat, lng, {
        id: starId,
        createdAt: timestamp,
        color: '#EDC727',
        notes: [note],
      });
      onCreated(starId, [lat, lng]);
      showPhotoLocationStatus(copy.photoLocationCreated, 500);
    } catch (error) {
      console.error('Could not create star from photo GPS:', error);
      showPhotoLocationStatus(copy.photoLocationFailed, 500);
    } finally {
      setIsReadingPhotoLocation(false);
    }
  }, [
    addStarAtLatLng,
    copy.noteImageAlt,
    copy.photoGpsNoteTitle,
    copy.photoLocationCreated,
    copy.photoLocationFailed,
    copy.photoLocationLoading,
    copy.photoLocationNoGps,
    copy.removeImage,
    isReadingPhotoLocation,
    onCreated,
    showPhotoLocationStatus,
  ]);

  return {
    isReadingPhotoLocation,
    photoLocationStatus,
    handlePhotoLocationInput,
  };
};
