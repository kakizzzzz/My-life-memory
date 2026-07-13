import type { StarData, UserProfile } from '../types/app';
import {
  buildReadableExportHtml,
  createSourceExportImageTask,
  createStoredExportImageTask,
  exportImageTasks,
  getInlineExportImageSources,
  hasImageExportError,
  type ExportImageTask,
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

export type UserDataExportProgress = (
  { stage: 'preparing' } |
  { stage: 'images'; completed: number; total: number } |
  { stage: 'generating' }
);

export const getUserDataExportProgressPercent = (progress: UserDataExportProgress) => {
  if (progress.stage === 'preparing') return 8;
  if (progress.stage === 'generating') return 96;

  const total = Math.max(0, progress.total);
  if (total === 0) return 90;
  const completed = Math.min(total, Math.max(0, progress.completed));
  return Math.round(10 + (completed / total) * 80);
};

export const exportReadableUserData = async ({
  stars,
  profile,
  languageLocale,
  copy,
  onProgress,
}: {
  stars: StarData[];
  profile: UserProfile;
  languageLocale: string;
  copy: UserDataExportCopy;
  onProgress?: (progress: UserDataExportProgress) => void;
}) => {
  onProgress?.({ stage: 'preparing' });
  const exportedAt = new Date().toISOString();
  const imageTasks: ExportImageTask[] = [];
  const locationDrafts = stars.map((star, starIndex) => {
    const notes = (star.notes || []).map((note, noteIndex) => {
      if (!hasMeaningfulNoteContent(note)) return null;
      const timestamp = getNoteTimestamp(note);
      const noteTasks = [
        ...getStoredImagesFromNote(note).map((metadata, imageIndex) => (
          createStoredExportImageTask(
            metadata,
            `locations.${starIndex}.notes.${noteIndex}.images.${imageIndex}`,
          )
        )),
        ...getInlineExportImageSources(note).map((src, imageIndex) => (
          createSourceExportImageTask(
            src,
            `locations.${starIndex}.notes.${noteIndex}.inlineImages.${imageIndex}`,
          )
        )),
      ];
      imageTasks.push(...noteTasks);

      return {
        title: htmlToText(note.titleHtml) || note.title || `${copy.noteLabel} ${noteIndex + 1}`,
        text: htmlToText(note.contentHtml) || note.content || '',
        timestamp,
        imageTasks: noteTasks,
      };
    });

    return {
      index: starIndex + 1,
      lat: star.lat,
      lng: star.lng,
      createdAt: star.createdAt || null,
      notes: notes.filter((note): note is NonNullable<typeof note> => Boolean(note)),
    };
  });

  const imageTaskResult = await exportImageTasks(imageTasks, {
    concurrency: 3,
    onProgress: progress => {
      if (progress.total > 0) onProgress?.({ stage: 'images', ...progress });
    },
  });
  const locations = locationDrafts.map(location => ({
    ...location,
    notes: location.notes.map(note => ({
      title: note.title,
      text: note.text,
      timestamp: note.timestamp,
      images: note.imageTasks
        .map(task => {
          const image = imageTaskResult.results.get(task.dedupeKey);
          return image ? { ...image, source: task.source } : null;
        })
        .filter((image): image is ExportedImageData => Boolean(image)),
    })),
  }));

  const readableLocations = locations.filter(location => location.notes.length > 0);
  onProgress?.({ stage: 'generating' });
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
    failedImageCount: imageTaskResult.failures.length,
    imageFailures: imageTaskResult.failures,
  };
};
