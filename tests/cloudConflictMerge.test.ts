import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCloudConflictState } from '../src/lib/cloudConflictMerge';
import type { NoteData, PersistedAppState, StarData } from '../src/types/app';

const note = (id: string, content: string, updatedAt = 1): NoteData => ({
  id,
  title: id,
  content,
  contentHtml: `<p>${content}</p>`,
  createdAt: 1,
  updatedAt,
});

const star = (notes: NoteData[]): StarData => ({
  id: 'star-1',
  lat: 31.2,
  lng: 121.4,
  notes,
});

const state = (notes: NoteData[]): PersistedAppState => ({
  language: 'zh',
  stars: [star(notes)],
  savedTracks: [],
});

test('keeps unrelated edits from local and remote devices', () => {
  const base = state([note('a', 'base-a'), note('b', 'base-b')]);
  const local = state([note('a', 'local-a', 2), note('b', 'base-b')]);
  const remote = state([note('a', 'base-a'), note('b', 'remote-b', 3)]);

  const merged = mergeCloudConflictState(base, local, remote, 'zh');
  const notes = merged.stars?.[0].notes || [];
  assert.equal(notes.find(item => item.id === 'a')?.content, 'local-a');
  assert.equal(notes.find(item => item.id === 'b')?.content, 'remote-b');
  assert.equal(notes.length, 2);
});

test('keeps a conflict copy when both devices edit the same note', () => {
  const base = state([note('a', 'base')]);
  const local = state([note('a', 'local', 2)]);
  const remote = state([note('a', 'remote', 3)]);

  const merged = mergeCloudConflictState(base, local, remote, 'zh');
  const notes = merged.stars?.[0].notes || [];
  assert.equal(notes.find(item => item.id === 'a')?.content, 'local');
  assert.equal(notes.find(item => item.id !== 'a')?.content, 'remote');
  assert.match(notes.find(item => item.id !== 'a')?.title || '', /冲突副本/);
});

test('preserves a deletion when the other device left the note unchanged', () => {
  const base = state([note('a', 'base')]);
  const local = state([]);
  const remote = state([note('a', 'base')]);

  const merged = mergeCloudConflictState(base, local, remote, 'zh');
  assert.deepEqual(merged.stars?.[0].notes, []);
});

test('preserves remote content when it was edited after a local deletion', () => {
  const base = state([note('a', 'base')]);
  const local = state([]);
  const remote = state([note('a', 'remote edit', 4)]);

  const merged = mergeCloudConflictState(base, local, remote, 'zh');
  assert.equal(merged.stars?.[0].notes?.[0].content, 'remote edit');
});

test('merges independent star metadata edits without creating a duplicate', () => {
  const base = state([note('a', 'base')]);
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.stars![0].color = '#112233';
  remote.stars![0].tagOrder = 2;

  const merged = mergeCloudConflictState(base, local, remote, 'zh');
  assert.equal(merged.stars?.length, 1);
  assert.equal(merged.stars?.[0].color, '#112233');
  assert.equal(merged.stars?.[0].tagOrder, 2);
});

test('keeps a remote star copy when both devices move the same star differently', () => {
  const base = state([note('a', 'base')]);
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.stars![0].lat = 31.3;
  remote.stars![0].lat = 31.4;

  const merged = mergeCloudConflictState(base, local, remote, 'zh');
  assert.equal(merged.stars?.length, 2);
  assert.equal(merged.stars?.[0].lat, 31.3);
  assert.equal(merged.stars?.[1].lat, 31.4);
  assert.deepEqual(merged.stars?.[1].notes, []);
  assert.match(merged.stars?.[1].id || '', /^star-1-conflict-/);
});

test('keeps a recoverable remote profile record for same-field conflicts', () => {
  const base = { ...state([]), profile: { name: 'Base', account: 'owner' } };
  const local = { ...state([]), profile: { name: 'Local', account: 'owner' } };
  const remote = { ...state([]), profile: { name: 'Remote', account: 'owner' } };

  const merged = mergeCloudConflictState(base, local, remote, 'zh');
  assert.equal(merged.profile?.name, 'Local');
  assert.equal(merged.profileConflicts?.[0].name, 'Remote');
  assert.equal(merged.profileConflicts?.[0].source, 'remote');
});
