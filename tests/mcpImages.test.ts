import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildMcpImageContent,
  isUserScopedMemoryImage,
  type MemoryImageReference,
} from '../supabase/functions/_shared/mcp-image-content.ts';
import { collectMemoryImageReferences } from '../supabase/functions/_shared/memory-image-references.ts';
import type { NoteRow } from '../supabase/functions/_shared/memory-record-types.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const reference = (path: string, noteId: string): MemoryImageReference => ({
  noteIds: [noteId],
  imageIndex: 0,
  provider: 'supabase',
  bucket: 'life-media',
  path,
  mimeType: 'image/jpeg',
  size: 3,
  createdAt: 1,
});

const note = (id: string, images: unknown[]): NoteRow => ({
  star_id: 'star-1',
  id,
  sort_order: 0,
  title: '',
  title_html: '',
  content: '',
  content_html: '',
  image_url: null,
  image_urls: [],
  images,
  font_size: null,
  title_font_size: null,
  color: null,
  created_at_ms: 1,
  updated_at_ms: 1,
});

test('note media collection keeps only safe active user paths and merges shared references', () => {
  const sharedPath = `${userId}/notes/shared/photo.webp`;
  const validImage = {
    provider: 'supabase',
    bucket: 'life-media',
    path: sharedPath,
    mimeType: 'image/webp',
    size: 120,
    createdAt: 10,
  };
  const collected = collectMemoryImageReferences([
    note('note-1', [
      validImage,
      { ...validImage, path: 'other-user/notes/private.jpg' },
      { ...validImage, path: `${userId}/notes/../private.jpg` },
      { ...validImage, bucket: 'public-media', path: `${userId}/notes/public.jpg` },
      { ...validImage, provider: 'external', path: `${userId}/notes/external.jpg` },
    ]),
    note('note-2', [{ ...validImage, key: sharedPath, path: '' }]),
  ], userId);

  assert.equal(collected.length, 1);
  assert.equal(collected[0].path, sharedPath);
  assert.deepEqual(collected[0].noteIds, ['note-1', 'note-2']);
});

test('MCP image content is user scoped, deduplicated, bounded, and emitted as image blocks', async () => {
  const firstPath = `${userId}/notes/a/one.jpg`;
  const media = [
    reference(firstPath, 'note-1'),
    reference(firstPath, 'note-2'),
    reference(`${userId}/notes/a/two.jpg`, 'note-1'),
    reference(`${userId}/notes/a/three.jpg`, 'note-1'),
    reference(`${userId}/notes/a/four.jpg`, 'note-1'),
  ];
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const result = await buildMcpImageContent({
    userId,
    media,
    maxImages: 3,
    download: async () => {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };
    },
  });

  assert.equal(calls, 3);
  assert.ok(maximumActive <= 2);
  assert.equal(result.summary.availableImageCount, 4);
  assert.equal(result.summary.returnedImageCount, 3);
  assert.deepEqual(result.summary.images[0].noteIds, ['note-1', 'note-2']);
  assert.equal(result.content.filter(block => block.type === 'image').length, 3);
});

test('MCP image content rejects cross-user and unsafe Storage paths before download', async () => {
  const valid = reference(`${userId}/notes/a/one.jpg`, 'note-1');
  assert.equal(isUserScopedMemoryImage(valid, userId), true);
  assert.equal(isUserScopedMemoryImage(reference('other-user/notes/a.jpg', 'note-1'), userId), false);
  assert.equal(isUserScopedMemoryImage(reference(`${userId}/notes/../secret.jpg`, 'note-1'), userId), false);
  let calls = 0;
  const result = await buildMcpImageContent({
    userId,
    media: [reference('other-user/notes/a.jpg', 'note-1')],
    download: async () => {
      calls += 1;
      return { bytes: new Uint8Array([1]), mimeType: 'image/jpeg' };
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.summary.returnedImageCount, 0);
  assert.match(result.summary.instruction, /Do not claim/);
});

test('Memory API and cloud MCP use active user-scoped note references without signed URLs', () => {
  const memoryApi = readFileSync(new URL('../supabase/functions/memory-api/index.ts', import.meta.url), 'utf8');
  const cloudMcp = readFileSync(new URL('../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
  const normalizedMemory = readFileSync(new URL('../supabase/functions/_shared/normalized-memory.ts', import.meta.url), 'utf8');
  assert.match(memoryApi, /action === 'get_note_media'/);
  assert.match(normalizedMemory, /query = query\.in\('id', options\.noteIds\)/);
  assert.match(memoryApi, /collectMemoryImageReferences\(memory\.notes, userId\)/);
  assert.match(cloudMcp, /name: 'get_memory_images'/);
  assert.match(cloudMcp, /storage\/v1\/object\/authenticated/);
  assert.match(cloudMcp, /apikey: config\.serviceRoleKey/);
  assert.doesNotMatch(cloudMcp, /createSignedUrl/);
});
