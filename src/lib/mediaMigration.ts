import { sanitizeRichHtml } from './htmlSanitizer';
import {
  dehydrateStorageMediaHtml,
  metadataAttrs,
  storagePlaceholderSrc,
  uploadImageToStorage,
  type StoredImageMetadata,
} from './mediaStorage';
import { dataUrlToFile } from './photoUtils';
import { getStoredImagesFromNote, uniqueStoredImages } from './noteHtmlUtils';
import type { NoteData, StarData, UserProfile } from '../types/app';

const isInlineImage = (src?: string | null) => Boolean(src && /^data:image\//i.test(src));

const migrateNote = async (note: NoteData) => {
  if (typeof document === 'undefined' || !note.contentHtml?.includes('data:image/')) return note;
  const container = document.createElement('div');
  container.innerHTML = sanitizeRichHtml(note.contentHtml);
  const inlineImages = Array.from(container.querySelectorAll<HTMLImageElement>('img'))
    .filter(image => isInlineImage(image.getAttribute('src')) && !image.dataset.mediaPath);
  if (inlineImages.length === 0) return note;

  const uploadedMetadata: StoredImageMetadata[] = [];
  for (const image of inlineImages) {
    const src = image.getAttribute('src') || '';
    try {
      const file = await dataUrlToFile(src, `${Date.now()}-${uploadedMetadata.length}.jpg`);
      const uploaded = await uploadImageToStorage(file, {
        folder: 'notes',
        noteId: note.id,
        fileName: file.name,
      });
      if (!uploaded.metadata) continue;
      Object.entries(metadataAttrs(uploaded.metadata)).forEach(([key, value]) => image.setAttribute(key, value));
      image.src = storagePlaceholderSrc(uploaded.metadata);
      uploadedMetadata.push(uploaded.metadata);
    } catch (error) {
      console.warn('Could not migrate inline note image to Storage:', error);
    }
  }

  if (uploadedMetadata.length === 0) return note;
  const contentHtml = sanitizeRichHtml(dehydrateStorageMediaHtml(container.innerHTML));
  return {
    ...note,
    contentHtml,
    images: uniqueStoredImages([...getStoredImagesFromNote(note), ...uploadedMetadata]),
    imageUrl: undefined,
    imageUrls: undefined,
  };
};

export const migrateInlineMediaToStorage = async (profile: UserProfile, stars: StarData[]) => {
  let nextProfile = profile;
  if (!profile.avatarImage && isInlineImage(profile.avatarUrl)) {
    try {
      const file = await dataUrlToFile(profile.avatarUrl, `avatar-${Date.now()}.jpg`);
      const uploaded = await uploadImageToStorage(file, {
        folder: 'avatars',
        noteId: 'profile',
        fileName: file.name,
      });
      if (uploaded.metadata) {
        nextProfile = {
          ...profile,
          avatarUrl: storagePlaceholderSrc(uploaded.metadata),
          avatarImage: uploaded.metadata,
        };
      }
    } catch (error) {
      console.warn('Could not migrate inline avatar to Storage:', error);
    }
  }

  const nextStars: StarData[] = [];
  for (const star of stars) {
    const nextNotes: NoteData[] = [];
    for (const note of star.notes || []) nextNotes.push(await migrateNote(note));
    nextStars.push({ ...star, notes: nextNotes });
  }
  const notesChanged = nextStars.some((star, index) => (
    star.notes?.some((note, noteIndex) => note !== stars[index]?.notes?.[noteIndex])
  ));

  return {
    profile: nextProfile,
    stars: notesChanged ? nextStars : stars,
    changed: nextProfile !== profile || notesChanged,
  };
};
