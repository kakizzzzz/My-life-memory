import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
} from '../supabase/functions/_shared/memory-record-types.ts';
import { buildMemoryQueryPlan } from '../supabase/functions/_shared/memory-query-plan.ts';
import { buildMemoryReferenceOptions } from '../supabase/functions/_shared/memory-reference-candidates.ts';
import {
  createMemoryReferenceToken,
  verifyMemoryReferenceToken,
} from '../supabase/functions/_shared/memory-reference-token.ts';

const star = (id: string, lat: number): StarRow => ({
  id,
  sort_order: 0,
  lat,
  lng: 120,
  created_at_ms: 1,
  tag_order: null,
  tag_group_id: null,
  color: '#cccccc',
});

const note = (id: string, starId: string, title: string, content: string): NoteRow => ({
  id,
  star_id: starId,
  sort_order: 0,
  created_at_ms: 1,
  updated_at_ms: 1,
  title,
  content,
  title_html: title,
  content_html: content,
  color: '#000000',
  font_size: 16,
  title_font_size: 18,
  image_url: '',
  image_urls: [],
  images: [],
});

const archive = (notes: NoteRow[]): NormalizedMemoryRows => ({
  userId: 'user-a',
  account: 'account-a',
  revision: 7,
  profile: null,
  stars: [star('star-a', 30), star('star-b', 31)],
  notes,
  tracks: [],
});

test('reference options are neutral and never expose note titles, text, dates, or places', () => {
  const memory = archive([
    note('note-a', 'star-a', 'Private title A', 'The lease and utilities are recorded here.'),
    note('note-b', 'star-b', 'Private title B', 'A second rent record is here.'),
  ]);
  const plan = buildMemoryQueryPlan({ query: 'Where is my home?' });
  const options = buildMemoryReferenceOptions({ memory, queryPlan: plan });

  assert.equal(options.length, 2);
  assert.deepEqual(options.map(option => option.label), ['Possible location 1', 'Possible location 2']);
  const visible = JSON.stringify(options.map(({ label }) => ({ label })));
  assert.doesNotMatch(visible, /Private title|lease|utilities|rent|star-|note-/u);
});

test('semantic hints may rank candidates but never appear in neutral labels', () => {
  const memory = archive([
    note('note-a', 'star-a', 'Alpha', 'A small orange animal appeared here.'),
    note('note-b', 'star-b', 'Beta', 'A quiet afternoon.'),
  ]);
  const plan = buildMemoryQueryPlan({ query: 'Where did I see that animal?' });
  const options = buildMemoryReferenceOptions({
    memory,
    queryPlan: plan,
    semanticHints: { concepts: [{ surface: 'animal', broadTerms: ['orange animal'] }] },
  });

  assert.equal(options[0]?.noteId, 'note-a');
  assert.equal(options[0]?.label, 'Possible record 1');
  assert.doesNotMatch(options[0]?.label || '', /orange|animal|Alpha/u);
});

test('confirmation token is bound to user, query, revision, expiry, and ciphertext integrity', async () => {
  const now = Date.parse('2026-07-18T00:00:00Z');
  const issued = await createMemoryReferenceToken({
    secret: 'test-secret-long-enough',
    userId: 'user-a',
    query: 'Where is my workplace?',
    revision: 7,
    now,
    ttlMs: 120_000,
    options: [{
      noteId: 'note-a',
      starId: 'star-a',
      relation: 'work',
      label: 'Possible location 1',
      score: 10,
    }],
  });

  const verify = (overrides: Partial<Parameters<typeof verifyMemoryReferenceToken>[0]> = {}) => (
    verifyMemoryReferenceToken({
      secret: 'test-secret-long-enough',
      token: issued.token,
      userId: 'user-a',
      query: 'Where is my workplace?',
      revision: 7,
      now: now + 1,
      ...overrides,
    })
  );

  assert.equal((await verify()).valid, true);
  assert.equal((await verify({ userId: 'user-b' })).reason, 'wrong-user');
  assert.equal((await verify({ query: 'Where is my school?' })).reason, 'wrong-query');
  assert.equal((await verify({ revision: 8 })).reason, 'stale-revision');
  assert.equal((await verify({ now: now + 120_001 })).reason, 'expired');
  const replacement = issued.token.endsWith('a') ? 'b' : 'a';
  const tampered = `${issued.token.slice(0, -1)}${replacement}`;
  assert.equal((await verify({ token: tampered })).reason, 'invalid-token');
});

test('token exposes only neutral labels while authenticated payload remains recoverable server-side', async () => {
  const issued = await createMemoryReferenceToken({
    secret: 'another-test-secret',
    userId: 'user-a',
    query: 'Which place?',
    revision: 1,
    options: [{
      noteId: 'note-private',
      starId: 'star-private',
      relation: 'activity',
      label: 'Possible record 1',
      score: 3,
    }],
  });

  assert.deepEqual(issued.options, [{ optionId: 'op_1', label: 'Possible record 1' }]);
  assert.equal(issued.token.includes('note-private'), false);
  assert.equal(issued.token.includes('star-private'), false);
  const verified = await verifyMemoryReferenceToken({
    secret: 'another-test-secret',
    token: issued.token,
    userId: 'user-a',
    query: 'Which place?',
    revision: 1,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.options[0].noteId, 'note-private');
  assert.equal(verified.options[0].starId, 'star-private');
});
