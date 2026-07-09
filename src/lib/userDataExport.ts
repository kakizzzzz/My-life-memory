import type { StarData, UserProfile } from '../types/app';
import {
  buildReadableExportHtml,
  exportImageSource,
  exportStoredImage,
  getInlineExportImageSources,
  hasImageExportError,
  type ExportedImageData,
} from './exportReport';
import { getNoteTimestamp } from './noteDataUtils';
import {
  getStoredImagesFromNote,
  hasMeaningfulNoteContent,
  htmlToText,
} from './noteHtmlUtils';
import { normalizeAccountId } from './accountUtils';

type UserDataExportCopy = {
  noteLabel: string;
};

export const exportReadableUserData = async ({
  stars,
  profile,
  languageLocale,
  copy,
}: {
  stars: StarData[];
  profile: UserProfile;
  languageLocale: string;
  copy: UserDataExportCopy;
}) => {
  const exportedAt = new Date().toISOString();
  const locations = await Promise.all(stars.map(async (star, starIndex) => {
    const notes = await Promise.all((star.notes || []).map(async (note, noteIndex) => {
      if (!hasMeaningfulNoteContent(note)) return null;
      const timestamp = getNoteTimestamp(note);
      const storedImages = await Promise.all(
        getStoredImagesFromNote(note).map((metadata, imageIndex) => (
          exportStoredImage(metadata, `locations.${starIndex}.notes.${noteIndex}.images.${imageIndex}`)
        ))
      );
      const inlineImages = await Promise.all(
        getInlineExportImageSources(note).map((src, imageIndex) => (
          exportImageSource(src, `locations.${starIndex}.notes.${noteIndex}.inlineImages.${imageIndex}`)
        ))
      );
      const images = [
        ...storedImages,
        ...inlineImages.filter((image): image is ExportedImageData => Boolean(image)),
      ];

      return {
        title: htmlToText(note.titleHtml) || note.title || `${copy.noteLabel} ${noteIndex + 1}`,
        text: htmlToText(note.contentHtml) || note.content || '',
        timestamp,
        images,
      };
    }));

    return {
      index: starIndex + 1,
      lat: star.lat,
      lng: star.lng,
      createdAt: star.createdAt || null,
      notes: notes.filter((note): note is NonNullable<typeof note> => Boolean(note)),
    };
  }));

  const readableLocations = locations.filter(location => location.notes.length > 0);
  const html = buildReadableExportHtml({
    appName: 'My Life Memory',
    account: normalizeAccountId(profile.account),
    profileName: profile.name,
    exportedAt,
    locale: languageLocale,
    locations: readableLocations,
  });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const accountSlug = normalizeAccountId(profile.account) || 'user';
  const dateSlug = exportedAt.slice(0, 10);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `my-life-memory-${accountSlug}-${dateSlug}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  return {
    hasImageError: hasImageExportError(readableLocations),
  };
};
