import type { NoteRow } from './memory-record-types.ts';
import { noteImages } from './memory-presenters.ts';
import type { MemoryImageReference } from './mcp-image-content.ts';

const SAFE_STORAGE_PATH = /^[A-Za-z0-9_.\/-]{1,1024}$/;

const safeUserPath = (path: string, userId: string) => {
  if (!path.startsWith(`${userId}/`) || !SAFE_STORAGE_PATH.test(path)) return false;
  return path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
};

export const collectMemoryImageReferences = (
  notes: NoteRow[],
  userId: string,
  limit = 60,
) => {
  const mediaByPath = new Map<string, MemoryImageReference>();
  notes.forEach(note => {
    noteImages(note).forEach((image, imageIndex) => {
      const path = image.path || image.key;
      if (image.provider !== 'supabase' || image.bucket !== 'life-media') return;
      if (!safeUserPath(path, userId)) return;
      const key = `${image.bucket}/${path}`;
      const existing = mediaByPath.get(key);
      if (existing) {
        if (!existing.noteIds.includes(note.id)) existing.noteIds.push(note.id);
        return;
      }
      mediaByPath.set(key, {
        noteIds: [note.id],
        imageIndex,
        provider: image.provider,
        bucket: image.bucket,
        path,
        mimeType: image.mimeType,
        size: image.size,
        createdAt: image.createdAt,
      });
    });
  });
  return [...mediaByPath.values()].slice(0, Math.max(0, limit));
};
