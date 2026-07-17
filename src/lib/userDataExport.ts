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
  htmlToText,
} from './noteHtmlUtils';
import { normalizeAccountId } from './accountUtils';
import { dateFromCalendarDateKey } from './dateUtils';

type UserDataExportCopy = {
  noteLabel: string;
};

export type UserDataExportProgress = (
  { stage: 'preparing' } |
  { stage: 'images'; completed: number; total: number } |
  { stage: 'generating' }
);

export type UserDataExportRange = {
  startDate?: string;
  endDate?: string;
};

const getExportRangeBounds = (range?: UserDataExportRange) => {
  const startDate = range?.startDate ? dateFromCalendarDateKey(range.startDate) : null;
  const endDate = range?.endDate ? dateFromCalendarDateKey(range.endDate) : null;
  if (range?.startDate && !startDate) throw new Error('Invalid export start date.');
  if (range?.endDate && !endDate) throw new Error('Invalid export end date.');

  const startAt = startDate?.getTime() ?? Number.NEGATIVE_INFINITY;
  const endAt = endDate
    ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1).getTime()
    : Number.POSITIVE_INFINITY;
  if (startAt >= endAt) throw new Error('Invalid export date range.');
  return { startAt, endAt };
};

export const filterStarsForUserDataExport = (
  stars: StarData[],
  range?: UserDataExportRange,
) => {
  const { startAt, endAt } = getExportRangeBounds(range);
  return stars
    .map(star => ({
      ...star,
      notes: (star.notes || []).filter(note => {
        const timestamp = getNoteTimestamp(note);
        return timestamp >= startAt && timestamp < endAt;
      }),
    }))
    .filter(star => (star.notes || []).length > 0);
};

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
  range,
  onProgress,
}: {
  stars: StarData[];
  profile: UserProfile;
  languageLocale: string;
  copy: UserDataExportCopy;
  range?: UserDataExportRange;
  onProgress?: (progress: UserDataExportProgress) => void;
}) => {
  onProgress?.({ stage: 'preparing' });
  const exportedAt = new Date().toISOString();
  const imageTasks: ExportImageTask[] = [];
  const selectedStars = filterStarsForUserDataExport(stars, range);
  const selectedNoteCount = selectedStars.reduce((total, star) => total + (star.notes || []).length, 0);
  if (selectedNoteCount === 0) {
    return {
      exported: false,
      noteCount: 0,
      hasImageError: false,
      failedImageCount: 0,
      imageFailures: [],
    };
  }

  const locationDrafts = selectedStars.map((star, starIndex) => {
    const notes = (star.notes || []).map((note, noteIndex) => {
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
      notes,
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
    exported: true,
    noteCount: selectedNoteCount,
    hasImageError: hasImageExportError(readableLocations),
    failedImageCount: imageTaskResult.failures.length,
    imageFailures: imageTaskResult.failures,
  };
};
