import type { NoteData } from '../types/app';

export const getNoteTimestamp = (note: NoteData) => {
  const candidate = note.createdAt || Number(note.id) || note.updatedAt;
  return Number.isFinite(candidate) && candidate > 0 ? candidate : Date.now();
};
