import type { NoteData } from '../types/app';
import { sanitizeRichHtml } from './htmlSanitizer';
import { dehydrateStorageMediaHtml } from './mediaStorage';
import { escapeHtml, getStoredImagesFromNote } from './noteHtmlUtils';

const comparableNotes = (notes: NoteData[]) => notes.map(note => ({
  id: note.id,
  titleHtml: sanitizeRichHtml(note.titleHtml ?? escapeHtml(note.title || '')),
  contentHtml: sanitizeRichHtml(dehydrateStorageMediaHtml(note.contentHtml || '')),
  fontSize: note.fontSize || 18,
  titleFontSize: note.titleFontSize || 18,
  color: note.color || '#D2936D',
  images: getStoredImagesFromNote(note).map(image => `${image.bucket}/${image.path}`).sort(),
}));

export const notesHaveMeaningfulChanges = (before: NoteData[], after: NoteData[]) => (
  JSON.stringify(comparableNotes(before)) !== JSON.stringify(comparableNotes(after))
);
