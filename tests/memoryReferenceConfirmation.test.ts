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

test('reference options expose only bounded safe cues rather than private bodies or ids', () => {
  const memory = archive([
    note('note-a', 'star-a', 'Private title A', 'The lease and utilities are recorded here.'),
    note('note-b', 'star-b', 'Private title B', 'A second rent record is here.'),
  ]);
  const plan = buildMemoryQueryPlan({ query: 'Where is my home?' });
  const options = buildMemoryReferenceOptions({ memory, queryPlan: plan });

  assert.equal(options.length, 2);
  assert.deepEqual(options.map(option => option.label), ['Record related to lease', 'Record related to rent']);
  assert.deepEqual(options.map(option => option.labelSource), ['soft-cue', 'soft-cue']);
  const visible = JSON.stringify(options.map(({ label, labelSource }) => ({ label, labelSource })));
  assert.doesNotMatch(visible, /Private title|utilities|star-|note-|30|31|120/u);
});

test('semantic hints may rank candidates while a safe short title supplies the label', () => {
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
  assert.equal(options[0]?.label, 'Alpha');
  assert.equal(options[0]?.labelSource, 'short-title');
  assert.doesNotMatch(options[0]?.label || '', /orange|animal/u);
});

test('unsafe short titles fall back to ordinal labels', () => {
  const memory = archive([
    note('note-a', 'star-a', '30.12345, 120.67890', 'A small animal appeared here.'),
    note('note-b', 'star-b', 'name@example.com', 'Another animal appeared here.'),
  ]);
  const plan = buildMemoryQueryPlan({ query: 'Where did I see that animal?' });
  const options = buildMemoryReferenceOptions({ memory, queryPlan: plan });

  assert.deepEqual(options.map(option => option.label), ['Possible record 1', 'Possible record 2']);
  assert.deepEqual(options.map(option => option.labelSource), ['ordinal', 'ordinal']);
  assert.doesNotMatch(JSON.stringify(options), /30\.12345|120\.67890|example\.com/u);
});

test('the safe-label gate rejects urls, phones, addresses, and long numbers', () => {
  const unsafeTitles = [
    'https://x.co',
    '13800138000',
    '123 Main St',
    '幸福路88号',
    'Order 12345',
  ];
  const plan = buildMemoryQueryPlan({ query: 'Where did I see that animal?' });
  unsafeTitles.forEach((title, index) => {
    const memory = archive([
      note(`note-${index}`, 'star-a', title, 'A small animal appeared here.'),
    ]);
    const options = buildMemoryReferenceOptions({ memory, queryPlan: plan });
    assert.equal(options[0]?.label, 'Possible record 1', title);
    assert.equal(options[0]?.labelSource, 'ordinal', title);
    assert.equal(JSON.stringify(options).includes(title), false, title);
  });
});

test('fuzzy references can present safe short titles without treating them as evidence', () => {
  const memory = archive([
    note('note-a', 'star-a', 'Mimi', 'A sunny afternoon.'),
    note('note-b', 'star-a', 'Tangerine', 'A quiet morning.'),
  ]);
  const plan = buildMemoryQueryPlan({ query: 'Where was that cat I saw?' });
  const options = buildMemoryReferenceOptions({ memory, queryPlan: plan });

  assert.equal(options.length, 2);
  assert.deepEqual(options.map(option => option.label), ['Mimi', 'Tangerine']);
  assert.deepEqual(options.map(option => option.labelSource), ['short-title', 'short-title']);
  assert.deepEqual(options.map(option => option.starId), ['star-a', 'star-a']);
});

test('an explicit safe name may label an option without exposing the surrounding body', () => {
  const memory = archive([
    note('note-a', 'star-a', 'A quiet afternoon memory', 'The small cat is called Mimi. Nothing else is public.'),
  ]);
  const plan = buildMemoryQueryPlan({ query: 'Where was that cat I saw?' });
  const options = buildMemoryReferenceOptions({ memory, queryPlan: plan });

  assert.equal(options[0]?.label, 'Mimi');
  assert.equal(options[0]?.labelSource, 'named-entity');
  assert.doesNotMatch(JSON.stringify(options), /Nothing else|quiet afternoon|small cat/u);
});

test('anchor options still deduplicate multiple notes at the same star', () => {
  const memory = archive([
    note('note-a', 'star-a', 'Lease', 'The lease is stored here.'),
    note('note-b', 'star-a', 'Utilities', 'Utilities are paid here.'),
  ]);
  const plan = buildMemoryQueryPlan({ query: 'Where is my home?' });
  const options = buildMemoryReferenceOptions({ memory, queryPlan: plan });

  assert.equal(options.length, 1);
  assert.equal(options[0]?.starId, 'star-a');
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
      labelSource: 'ordinal',
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
  const shortReply = await verify({ query: 'Yes.' });
  assert.equal(shortReply.valid, true);
  assert.equal(shortReply.originalQuery, 'Where is my workplace?');
  assert.equal((await verify({ revision: 8 })).reason, 'stale-revision');
  assert.equal((await verify({ now: now + 120_001 })).reason, 'expired');
  const replacement = issued.token.endsWith('a') ? 'b' : 'a';
  const tampered = `${issued.token.slice(0, -1)}${replacement}`;
  assert.equal((await verify({ token: tampered })).reason, 'invalid-token');
});

test('token exposes only approved public labels while authenticated payload remains recoverable server-side', async () => {
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
      labelSource: 'ordinal',
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
