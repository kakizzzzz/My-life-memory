import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePersistedAppState } from '../src/lib/appStateNormalize';
import {
  convertLegacyPendingSnapshotToMutations,
  extractPendingMemoryMediaPaths,
  memoryOutboxForUser,
  newestMemoryOutboxForUser,
} from '../src/lib/memoryOutbox';
import {
  assembleNormalizedMemoryState,
  compactMemoryMutations,
  diffMemoryState,
  memoryMutationKey,
  mutationsAreDisjointFromRemote,
  preserveMutationConflicts,
  reconcileMemoryMutationsAfterRemoteAdvance,
  rebaseMemoryMutationBases,
  validateMemoryMutations,
} from '../src/lib/normalizedMemory';
import type { PersistedAppState } from '../src/types/app';
import {
  dateKeyFor,
  isInDateRange,
} from '../supabase/functions/_shared/memory-date';

const profile = { account: 'owner', name: 'Owner', avatarUrl: '' };
const baseState = (): PersistedAppState => ({
  mapStyle: 'light',
  language: 'en',
  systemTheme: {},
  profile: { account: 'owner', name: 'Owner', avatarUrl: '' },
  profileConflicts: [],
  stars: [{
    id: 'star-1', lat: 31.2, lng: 121.4, createdAt: 10,
    notes: [{ id: 'note-1', title: 'A', content: 'base', contentHtml: '<p>base</p>', createdAt: 11, updatedAt: 11 }],
  }],
  savedTracks: [{
    id: 'track-1', paths: [[[31.2, 121.4], [31.21, 121.41]]],
    time: 12, distance: 0.2, createdAt: 12, updatedAt: 12,
  }],
});

test('normalization does not silently truncate 5001 stars or 1001 tracks', () => {
  const stars = Array.from({ length: 5001 }, (_, index) => ({
    id: `star-${index}`, lat: 30 + index / 100000, lng: 120,
  }));
  const savedTracks = Array.from({ length: 1001 }, (_, index) => ({
    id: `track-${index}`,
    paths: [[[30, 120], [30.0001, 120.0001]]],
    time: index,
    distance: 0,
  }));
  const normalized = normalizePersistedAppState({ stars, savedTracks });
  assert.equal(normalized.stars.length, 5001);
  assert.equal(normalized.savedTracks.length, 1001);
});

test('normalization preserves a valid legacy image larger than the old 140KB cutoff', () => {
  const imageUrl = `data:image/jpeg;base64,${'A'.repeat(150_000)}`;
  const normalized = normalizePersistedAppState({
    stars: [{
      id: 'star-image', lat: 30, lng: 120,
      notes: [{ id: 'note-image', imageUrl, imageUrls: [imageUrl] }],
    }],
    savedTracks: [],
  });
  assert.equal(normalized.stars[0].notes[0].imageUrl, imageUrl);
  assert.equal(normalized.stars[0].notes[0].imageUrls[0], imageUrl);
});

test('normalized rows restore every id and sort_order without first-page loss', () => {
  const state = assembleNormalizedMemoryState({
    profile,
    settings: {
      user_id: 'user-1', map_style: 'dark', system_theme: {}, language: 'zh',
      profile_conflicts: [], profile_metadata: {}, dataset_revision: 7,
      data_model_version: 2, migration_verified_at: '2026-07-13T00:00:00Z',
    },
    stars: [
      { user_id: 'user-1', id: 'second', sort_order: 1, lat: 2, lng: 2, created_at_ms: 2, tag_order: null, tag_group_id: null, color: null, changed_revision: 7, deleted_at: null },
      { user_id: 'user-1', id: 'first', sort_order: 0, lat: 1, lng: 1, created_at_ms: 1, tag_order: null, tag_group_id: null, color: null, changed_revision: 7, deleted_at: null },
    ],
    notes: [
      { user_id: 'user-1', star_id: 'first', id: 'note-b', sort_order: 1, title: '', title_html: '', content: 'B', content_html: '<p>B</p>', image_url: null, image_urls: [], images: [], font_size: null, title_font_size: null, color: null, created_at_ms: 2, updated_at_ms: 2, changed_revision: 7, deleted_at: null },
      { user_id: 'user-1', star_id: 'first', id: 'note-a', sort_order: 0, title: '', title_html: '', content: 'A', content_html: '<p>A</p>', image_url: null, image_urls: [], images: [], font_size: null, title_font_size: null, color: null, created_at_ms: 1, updated_at_ms: 1, changed_revision: 7, deleted_at: null },
    ],
    tracks: [],
  });
  assert.deepEqual(state.stars?.map(star => star.id), ['first', 'second']);
  assert.deepEqual(state.stars?.[0].notes?.map(note => note.id), ['note-a', 'note-b']);
  assert.equal(state.mapStyle, 'dark');
  assert.equal(state.language, 'zh');
});

test('editing one note produces only one note mutation', () => {
  const base = baseState();
  const next = structuredClone(base);
  next.stars![0].notes![0].content = 'edited';
  next.stars![0].notes![0].contentHtml = '<p>edited</p>';
  next.stars![0].notes![0].updatedAt = 20;
  const changes = diffMemoryState({ baseState: base, nextState: next, baseProfile: profile, nextProfile: profile });
  assert.deepEqual(changes.map(change => change.type), ['note_upsert']);
  assert.equal(changes[0].entityId, 'note-1');
});

test('adding one star does not rewrite existing notes or routes', () => {
  const base = baseState();
  const next = structuredClone(base);
  next.stars!.push({ id: 'star-2', lat: 32, lng: 122, notes: [] });
  const changes = diffMemoryState({ baseState: base, nextState: next, baseProfile: profile, nextProfile: profile });
  assert.deepEqual(changes.map(change => change.type), ['star_upsert']);
  assert.equal(changes[0].entityId, 'star-2');
});

test('independent entity edits rebase while same-note edits preserve a conflict copy', () => {
  const base = baseState();
  const local = structuredClone(base);
  local.stars![0].notes![0].content = 'local';
  local.stars![0].notes![0].contentHtml = '<p>local</p>';
  const localChanges = diffMemoryState({ baseState: base, nextState: local, baseProfile: profile, nextProfile: profile });

  const disjointRemote = structuredClone(base);
  disjointRemote.savedTracks![0].color = '#112233';
  assert.equal(mutationsAreDisjointFromRemote(localChanges, disjointRemote, profile), true);

  const conflictingRemote = structuredClone(base);
  conflictingRemote.stars![0].notes![0].content = 'remote';
  conflictingRemote.stars![0].notes![0].contentHtml = '<p>remote</p>';
  const preserved = preserveMutationConflicts(localChanges, conflictingRemote, profile, 'en');
  assert.equal(preserved.length, 1);
  assert.equal(preserved[0].type, 'note_upsert');
  assert.notEqual(preserved[0].entityId, 'note-1');
  assert.equal(preserved[0].payload?.content, 'local');
});

test('legacy IndexedDB snapshot converts from baseState instead of being discarded', () => {
  const base = baseState();
  const pending = structuredClone(base);
  pending.stars![0].notes![0].content = 'offline edit';
  const mutations = convertLegacyPendingSnapshotToMutations({
    userId: 'user-1',
    state: pending,
    profile,
    baseRevision: 4,
    sequence: 1,
    savedAt: 1,
    language: 'en',
    baseState: base,
  }, profile);
  assert.equal(mutations?.length, 1);
  assert.equal(mutations?.[0].type, 'note_upsert');
  assert.equal(mutations?.[0].payload?.content, 'offline edit');
});

test('profile conflicts retain the remote profile in settings history data', () => {
  const base = baseState();
  const localProfile = { ...profile, name: 'Local name' };
  const remoteProfile = { ...profile, name: 'Remote name' };
  const profileChanges = diffMemoryState({
    baseState: base,
    nextState: base,
    baseProfile: profile,
    nextProfile: localProfile,
  });
  const preserved = preserveMutationConflicts(profileChanges, base, remoteProfile, 'en');
  const settings = preserved.find(change => change.type === 'settings_update');
  const conflicts = settings?.payload?.profileConflicts as Array<{ name?: string }> | undefined;
  assert.equal(conflicts?.[0]?.name, 'Remote name');
  assert.equal(preserved.find(change => change.type === 'profile_update')?.payload?.name, 'Local name');
});

test('outbox compaction preserves a true null base and cancels add-then-delete', () => {
  const added = {
    mutationId: 'add', type: 'star_upsert' as const, entityId: 'temporary',
    payload: { id: 'temporary', lat: 1, lng: 1 }, base: null, createdAt: 1,
  };
  const removed = {
    mutationId: 'remove', type: 'star_soft_delete' as const, entityId: 'temporary',
    base: { id: 'temporary', lat: 1, lng: 1 }, createdAt: 2,
  };
  assert.deepEqual(compactMemoryMutations([added, removed]), []);
});

test('confirmed intermediate edits rebase the remaining mutation base', () => {
  const base = baseState();
  const first = structuredClone(base);
  first.stars![0].notes![0].content = 'first local edit';
  const second = structuredClone(first);
  second.stars![0].notes![0].content = 'second local edit';
  const firstMutation = diffMemoryState({
    baseState: base, nextState: first, baseProfile: profile, nextProfile: profile,
  })[0];
  const compacted = compactMemoryMutations([
    firstMutation,
    ...diffMemoryState({ baseState: first, nextState: second, baseProfile: profile, nextProfile: profile }),
  ]);
  const rebased = rebaseMemoryMutationBases(compacted, first, profile);
  assert.equal(rebased[0].base?.content, 'first local edit');
  assert.equal(rebased[0].payload?.content, 'second local edit');
  assert.equal(memoryMutationKey(rebased[0]), 'note:star-1:note-1');
});

test('an acknowledged in-flight edit rebases a newer local edit after response loss', () => {
  const base = baseState();
  const first = structuredClone(base);
  first.stars![0].notes![0].content = 'server received this edit';
  const second = structuredClone(first);
  second.stars![0].notes![0].content = 'newer edit made before the response';
  const firstMutation = diffMemoryState({
    baseState: base, nextState: first, baseProfile: profile, nextProfile: profile,
  })[0];
  const pendingMutations = compactMemoryMutations([
    firstMutation,
    ...diffMemoryState({ baseState: first, nextState: second, baseProfile: profile, nextProfile: profile }),
  ]);
  const reconciled = reconcileMemoryMutationsAfterRemoteAdvance({
    pendingMutations,
    inFlightMutations: [firstMutation],
    remoteState: first,
    remoteProfile: profile,
  });
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].base?.content, 'server received this edit');
  assert.equal(reconciled[0].payload?.content, 'newer edit made before the response');
  assert.equal(mutationsAreDisjointFromRemote(reconciled, first, profile), true);
});

test('pending outbox media scanning protects only the active user folder', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const ownMetadataPath = `${userId}/notes/note-1/image-1.jpg`;
  const ownHtmlPath = `${userId}/notes/note-2/image-2.webp`;
  const otherPath = '22222222-2222-4222-8222-222222222222/notes/note-9/image.jpg';
  const paths = extractPendingMemoryMediaPaths({
    payload: {
      images: [{
        provider: 'supabase', bucket: 'life-media', path: ownMetadataPath,
        mimeType: 'image/jpeg', size: 100, createdAt: 1,
      }, {
        provider: 'supabase', bucket: 'life-media', path: otherPath,
        mimeType: 'image/jpeg', size: 100, createdAt: 1,
      }],
      contentHtml: `<p>x</p><img data-media-path="${ownHtmlPath}" src="storage://life-media/${ownHtmlPath}">`,
    },
  }, userId);
  assert.deepEqual(paths.sort(), [ownHtmlPath, ownMetadataPath].sort());
});

test('pending outbox selection never crosses account boundaries', () => {
  const firstUser = '11111111-1111-4111-8111-111111111111';
  const secondUser = '22222222-2222-4222-8222-222222222222';
  const firstOutbox = {
    userId: firstUser,
    expectedRevision: 1,
    mutations: [],
    sequence: 99,
    savedAt: 99,
    language: 'en',
  };
  const secondOutbox = {
    userId: secondUser,
    expectedRevision: 1,
    mutations: [],
    sequence: 1,
    savedAt: 1,
    language: 'zh',
  };

  assert.equal(memoryOutboxForUser(firstOutbox, secondUser), null);
  assert.equal(newestMemoryOutboxForUser(firstOutbox, secondOutbox, secondUser), secondOutbox);
  assert.equal(newestMemoryOutboxForUser(firstOutbox, null, secondUser), null);
});

test('note edit versus remote parent-star deletion preserves a valid star and all local notes', () => {
  const base = baseState();
  base.stars![0].notes!.push({
    id: 'note-2', title: 'B', content: 'unchanged sibling', createdAt: 12, updatedAt: 12,
  });
  const local = structuredClone(base);
  local.stars![0].notes![0].content = 'local survives';
  local.stars![0].notes![0].contentHtml = '<p>local survives</p>';
  const localChanges = diffMemoryState({
    baseState: base, nextState: local, baseProfile: profile, nextProfile: profile,
  });
  const remote = structuredClone(base);
  remote.stars = [];
  const preserved = preserveMutationConflicts(localChanges, remote, profile, 'en', local);
  const copiedStar = preserved.find(item => item.type === 'star_upsert');
  assert.ok(copiedStar);
  const copiedNotes = preserved.filter(item => item.type === 'note_upsert');
  assert.equal(copiedNotes.length, 2);
  assert.ok(copiedNotes.every(item => item.starId === copiedStar.entityId));
  assert.equal(copiedNotes.find(item => item.entityId === 'note-1')?.payload?.content, 'local survives');
  assert.equal(copiedNotes.find(item => item.entityId === 'note-2')?.payload?.content, 'unchanged sibling');
});

test('invalid route measurements are rejected instead of silently clamped', () => {
  assert.throws(() => validateMemoryMutations([{
    mutationId: 'bad-route',
    type: 'track_upsert',
    entityId: 'route-1',
    payload: {
      id: 'route-1', sortOrder: 0, paths: [[[30, 120], [30.1, 120.1]]],
      durationSeconds: -1, distanceKm: -0.2,
    },
    base: null,
    createdAt: 1,
  }]), /invalid duration or distance/);
});

test('an unknown legacy route date never becomes 1970', () => {
  const normalized = normalizePersistedAppState({
    savedTracks: [{
      id: 'legacy-undated',
      paths: [[[30, 120], [30.1, 120.1]]],
      createdAt: null,
    }],
  });
  assert.equal(normalized.savedTracks[0].createdAt, undefined);
  assert.equal(dateKeyFor(null), '');
  assert.equal(dateKeyFor(undefined), '');
  assert.equal(isInDateRange(null, '1970-01-01', '1970-01-01'), false);
});
