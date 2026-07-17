import { sanitizeRichHtml } from './htmlSanitizer';
import {
  dehydrateStorageMediaHtml,
  discardUploadedImageForScope,
  metadataAttrs,
  storagePlaceholderSrc,
  uploadImageToStorage,
  type MediaAccountScope,
  type StoredImageMetadata,
} from './mediaStorage';
import { dataUrlToFile } from './photoUtils';
import { getStoredImagesFromNote, uniqueStoredImages } from './noteHtmlUtils';
import type { NoteData, StarData, UserProfile } from '../types/app';

const isInlineImage = (src?: string | null) => Boolean(src && /^data:image\//i.test(src));

type MediaMigrationOptions = {
  accountScope?: MediaAccountScope;
  isCurrent?: () => boolean;
};

class MediaMigrationScopeChangedError extends Error {
  constructor() {
    super('The media migration account changed.');
    this.name = 'MediaMigrationScopeChangedError';
  }
}

const assertMigrationCurrent = (options: MediaMigrationOptions) => {
  if (options.isCurrent && !options.isCurrent()) {
    throw new MediaMigrationScopeChangedError();
  }
};

const migrateNote = async (
  note: NoteData,
  options: MediaMigrationOptions,
  migrationUploads: StoredImageMetadata[],
) => {
  assertMigrationCurrent(options);
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
      assertMigrationCurrent(options);
      const file = await dataUrlToFile(src, `${Date.now()}-${uploadedMetadata.length}.jpg`);
      assertMigrationCurrent(options);
      const uploaded = await uploadImageToStorage(file, {
        folder: 'notes',
        noteId: note.id,
        fileName: file.name,
        accountScope: options.accountScope,
      });
      if (!uploaded.metadata) continue;
      uploadedMetadata.push(uploaded.metadata);
      migrationUploads.push(uploaded.metadata);
      assertMigrationCurrent(options);
      Object.entries(metadataAttrs(uploaded.metadata)).forEach(([key, value]) => image.setAttribute(key, value));
      image.src = storagePlaceholderSrc(uploaded.metadata);
    } catch (error) {
      if (error instanceof MediaMigrationScopeChangedError) throw error;
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

export const migrateInlineMediaToStorage = async (
  profile: UserProfile,
  stars: StarData[],
  options: MediaMigrationOptions = {},
) => {
  const migrationUploads: StoredImageMetadata[] = [];

  try {
    assertMigrationCurrent(options);
    let nextProfile = profile;
    if (!profile.avatarImage && isInlineImage(profile.avatarUrl)) {
      try {
        assertMigrationCurrent(options);
        const file = await dataUrlToFile(profile.avatarUrl, `avatar-${Date.now()}.jpg`);
        assertMigrationCurrent(options);
        const uploaded = await uploadImageToStorage(file, {
          folder: 'avatars',
          noteId: 'profile',
          fileName: file.name,
          accountScope: options.accountScope,
        });
        if (uploaded.metadata) {
          migrationUploads.push(uploaded.metadata);
          assertMigrationCurrent(options);
          nextProfile = {
            ...profile,
            avatarUrl: storagePlaceholderSrc(uploaded.metadata),
            avatarImage: uploaded.metadata,
          };
        }
      } catch (error) {
        if (error instanceof MediaMigrationScopeChangedError) throw error;
        console.warn('Could not migrate inline avatar to Storage:', error);
      }
    }

    const nextStars: StarData[] = [];
    for (const star of stars) {
      assertMigrationCurrent(options);
      const nextNotes: NoteData[] = [];
      for (const note of star.notes || []) {
        nextNotes.push(await migrateNote(note, options, migrationUploads));
      }
      nextStars.push({ ...star, notes: nextNotes });
    }
    const notesChanged = nextStars.some((star, index) => (
      star.notes?.some((note, noteIndex) => note !== stars[index]?.notes?.[noteIndex])
    ));

    return {
      profile: nextProfile,
      stars: notesChanged ? nextStars : stars,
      changed: nextProfile !== profile || notesChanged,
      aborted: false,
    };
  } catch (error) {
    if (!(error instanceof MediaMigrationScopeChangedError)) throw error;
    if (options.accountScope) {
      const accountScope = options.accountScope;
      await Promise.allSettled(
        migrationUploads.map(metadata => discardUploadedImageForScope(metadata, accountScope)),
      );
    }
    return {
      profile,
      stars,
      changed: false,
      aborted: true,
    };
  }
};
