import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvePersonalMemoryContext,
} from '../supabase/functions/_shared/memory-personal-context.ts';
import {
  researchMemoryContext,
} from '../supabase/functions/_shared/memory-research.ts';
import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
  TrackRow,
} from '../supabase/functions/_shared/memory-record-types.ts';

const timestamp = (value: string) => Date.parse(`${value}T12:00:00Z`);

const star = (id: string, lat: number, lng: number, createdAt = '2026-01-01'): StarRow => ({
  id,
  sort_order: 0,
  lat,
  lng,
  created_at_ms: timestamp(createdAt),
  tag_order: null,
  tag_group_id: null,
  color: '#cccccc',
});

const note = ({
  id,
  starId,
  createdAt = '2026-01-01',
  title = '',
  content = '',
  imagePath = '',
}: {
  id: string;
  starId: string;
  createdAt?: string;
  title?: string;
  content?: string;
  imagePath?: string;
}): NoteRow => ({
  star_id: starId,
  id,
  sort_order: 0,
  title,
  title_html: title ? `<p>${title}</p>` : '',
  content,
  content_html: content ? `<p>${content}</p>` : '',
  image_url: null,
  image_urls: imagePath ? [imagePath] : [],
  images: [],
  font_size: null,
  title_font_size: null,
  color: null,
  created_at_ms: timestamp(createdAt),
  updated_at_ms: timestamp(createdAt),
});

const track = (id: string, createdAt: string, points: [number, number][]): TrackRow => ({
  id,
  sort_order: 0,
  paths: [points],
  color: '#cccccc',
  duration_seconds: 300,
  distance_km: 1.5,
  created_at_ms: timestamp(createdAt),
  updated_at_ms: timestamp(createdAt),
});

const memory = (
  stars: StarRow[],
  notes: NoteRow[],
  tracks: TrackRow[] = [],
): NormalizedMemoryRows => ({
  userId: 'user-1',
  account: 'owner',
  profile: null,
  revision: 1,
  stars,
  notes,
  tracks,
});

test('negated, third-party, quoted, and incidental place mentions do not establish identity', () => {
  const places = [
    star('negated-home', 31.1, 121.1),
    star('friend-home', 31.2, 121.2),
    star('company-visit', 31.3, 121.3),
    star('school-pass', 31.4, 121.4),
    star('client-office', 31.5, 121.5),
    star('quoted-home', 31.6, 121.6),
  ];
  const archive = memory(places, [
    note({ id: 'negated', starId: 'negated-home', content: '这里不是我家。' }),
    note({ id: 'friend', starId: 'friend-home', content: '朋友的家在这里。' }),
    note({ id: 'company', starId: 'company-visit', content: '今天参观了一家公司。' }),
    note({ id: 'school', starId: 'school-pass', content: '旅行时经过一所学校。' }),
    note({ id: 'client', starId: 'client-office', content: '客户的办公室很漂亮。' }),
    note({ id: 'quote', starId: 'quoted-home', content: '朋友说：“这里是我家”。' }),
  ]);

  assert.equal(resolvePersonalMemoryContext(archive, '我家在哪里', 5).status, 'not-found');
  assert.equal(resolvePersonalMemoryContext(archive, '我工作的地方', 5).status, 'not-found');
  assert.equal(resolvePersonalMemoryContext(archive, '我学习的地方', 5).status, 'not-found');
});

test('direct first-person identity evidence resolves across supported languages', () => {
  const cases = [
    ['这里是我家。', '我家附近'],
    ['This is my home.', 'near my home'],
    ['ここが自宅です。', '家の近く'],
    ['여기가 우리 집이에요.', '우리 집 근처'],
  ] as const;
  cases.forEach(([content, query], index) => {
    const place = star(`home-${index}`, 31 + index / 100, 121);
    const result = resolvePersonalMemoryContext(memory(
      [place],
      [note({ id: `note-${index}`, starId: place.id, content })],
    ), query, 5);
    assert.equal(result.status, 'resolved', content);
    assert.deepEqual(result.anchors.map(anchor => anchor.starId), [place.id], content);
  });
});

test('two independent corroborating passages can resolve an anchor but duplicates cannot inflate confidence', () => {
  const place = star('corroborated-home', 31.2, 121.4);
  const distinct = resolvePersonalMemoryContext(memory(
    [place],
    [
      note({ id: 'first', starId: place.id, content: '我家门口有棵树。' }),
      note({ id: 'second', starId: place.id, content: '我的住处旁边有一家店。' }),
    ],
  ), '我家附近', 5);
  const duplicated = resolvePersonalMemoryContext(memory(
    [place],
    [
      note({ id: 'copy-a', starId: place.id, content: '我家门口有棵树。' }),
      note({ id: 'copy-b', starId: place.id, content: '我家门口有棵树。' }),
    ],
  ), '我家附近', 5);

  assert.equal(distinct.status, 'resolved');
  assert.equal(distinct.episodes[0].evidenceStrength, 'corroborated');
  assert.equal(duplicated.status, 'not-found');
});

test('dated personal queries select the matching anchor episode while undated queries remain ambiguous', () => {
  const oldHome = star('old-home', 31.2, 121.4, '2024-03-01');
  const newHome = star('new-home', 31.3, 121.5, '2026-03-01');
  const latestUnrelated = star('latest-unrelated', 30.2, 120.4, '2026-07-10');
  const archive = memory(
    [oldHome, newHome, latestUnrelated],
    [
      note({ id: 'old-home-note', starId: oldHome.id, createdAt: '2024-03-01', content: '这里是我家，我住在这里。' }),
      note({ id: 'new-home-note', starId: newHome.id, createdAt: '2026-03-01', content: '这里是我家，我住在这里。' }),
      note({ id: 'latest-note', starId: latestUnrelated.id, createdAt: '2026-07-10', content: '普通的旅行记录。' }),
    ],
  );
  const oldResult = researchMemoryContext(archive, { query: '2024 年我家附近' });
  const undated = researchMemoryContext(archive, { query: '我家附近' });

  assert.equal(oldResult.personalContext.status, 'resolved');
  assert.deepEqual(oldResult.personalContext.anchors.map(anchor => anchor.starId), ['old-home']);
  assert.equal(undated.personalContext.status, 'ambiguous');
  assert.deepEqual(new Set(undated.personalContext.anchors.map(anchor => anchor.starId)), new Set(['old-home', 'new-home']));
  assert.equal(undated.latestRecordedMemory, null);
});

test('anchor, nearby radius, event, and target constraints compose without returning the anchor as the answer', () => {
  const home = star('home', 31.2304, 121.4737);
  const dolphin = star('dolphin', 31.234, 121.477);
  const nearbyNoise = star('nearby-noise', 31.235, 121.478);
  const farDolphin = star('far-dolphin', 30.2741, 120.1551);
  const archive = memory(
    [home, dolphin, nearbyNoise, farDolphin],
    [
      note({ id: 'home-note', starId: home.id, content: '这里是我家，我住在这里。' }),
      note({ id: 'dolphin-note', starId: dolphin.id, content: '我在这里看到了海豚。', imagePath: 'user-1/notes/dolphin/photo.jpg' }),
      note({ id: 'noise-note', starId: nearbyNoise.id, content: '在附近喝了咖啡。' }),
      note({ id: 'far-note', starId: farDolphin.id, content: '我在这里看到了海豚。' }),
    ],
  );
  const result = researchMemoryContext(archive, { query: '我家附近在哪里看到过海豚？', radiusKm: 2 });

  assert.equal(result.personalContext.status, 'resolved');
  assert.deepEqual(result.selectedNoteIds, ['dolphin-note']);
  assert.deepEqual(result.selectedImageNoteIds, ['dolphin-note']);
  assert.equal(result.evidencePassages.some(passage => passage.noteId === 'home-note' && passage.role === 'anchor'), true);
  assert.equal(result.evidencePassages.some(passage => passage.noteId === 'dolphin-note' && passage.role === 'target'), true);
  assert.equal(result.evidencePassages.every(passage => passage.text.length <= 240), true);
  assert.equal(result.selectedImageNoteIds.every(id => result.selectedNoteIds.includes(id)), true);
  assert.equal(result.selectedImageNoteIds.every(id => result.evidencePassages.some(passage => passage.noteId === id)), true);
});

test('bounded evidence keeps target passages and image IDs when anchor evidence is abundant', () => {
  const home = star('busy-home', 31.2304, 121.4737);
  const dolphin = star('busy-dolphin', 31.234, 121.477);
  const homeNotes = Array.from({ length: 12 }, (_, index) => note({
    id: `home-evidence-${index}`,
    starId: home.id,
    createdAt: `2026-01-${String(index + 1).padStart(2, '0')}`,
    content: `这里是我家，我住在这里。第 ${index + 1} 条独立记录。`,
  }));
  const result = researchMemoryContext(memory(
    [home, dolphin],
    [
      ...homeNotes,
      note({
        id: 'bounded-dolphin-note',
        starId: dolphin.id,
        content: '我在这里看到了海豚。',
        imagePath: 'user-1/notes/dolphin/bounded.jpg',
      }),
    ],
  ), { query: '我家附近在哪里看到过海豚？', radiusKm: 2 });

  assert.equal(result.evidencePassages.length <= 12, true);
  assert.equal(result.evidencePassages.some(passage => (
    passage.noteId === 'bounded-dolphin-note' && passage.role === 'target'
  )), true);
  assert.deepEqual(result.selectedImageNoteIds, ['bounded-dolphin-note']);
});

test('work-nearby activity queries return only supported activity notes', () => {
  const office = star('office', 31.2, 121.4);
  const restaurant = star('restaurant', 31.204, 121.404);
  const park = star('park', 31.205, 121.405);
  const result = researchMemoryContext(memory(
    [office, restaurant, park],
    [
      note({ id: 'office-note', starId: office.id, content: '我在这里工作。' }),
      note({ id: 'meal-note', starId: restaurant.id, content: '下班后我在这里吃了咖喱饭。' }),
      note({ id: 'park-note', starId: park.id, content: '在公园里看书。' }),
    ],
  ), { query: '我工作地点附近吃过什么？', radiusKm: 2 });

  assert.equal(result.personalContext.status, 'resolved');
  assert.deepEqual(result.selectedNoteIds, ['meal-note']);
});

test('a target title may pair with its own body action but never with another note body', () => {
  const supported = star('supported', 31.2, 121.4);
  const titleOnly = star('title-only', 31.3, 121.5);
  const actionOnly = star('action-only', 31.4, 121.6);
  const result = researchMemoryContext(memory(
    [supported, titleOnly, actionOnly],
    [
      note({ id: 'supported-note', starId: supported.id, title: '海豚', content: '我在这里看到了它。' }),
      note({ id: 'title-only-note', starId: titleOnly.id, title: '海豚', content: '普通的一天。' }),
      note({ id: 'action-only-note', starId: actionOnly.id, content: '我在这里看到了东西。' }),
    ],
  ), { query: '我在哪里看到过海豚？' });

  assert.deepEqual(result.selectedNoteIds, ['supported-note']);
  assert.equal(result.evidencePassages[0].evidenceStrength, 'corroborating');
  assert.equal(result.confidenceKind, 'heuristic');
  assert.equal(result.confidenceBand, 'medium');
});

test('nearby routes are returned only after a single personal anchor resolves', () => {
  const home = star('home', 31.2, 121.4);
  const secondHome = star('second-home', 30.2, 120.4);
  const nearRoute = track('near-route', '2026-01-02', [[31.2, 121.4], [31.205, 121.405]]);
  const farRoute = track('far-route', '2026-01-02', [[30.2, 120.4], [30.205, 120.405]]);
  const resolved = researchMemoryContext(memory(
    [home],
    [note({ id: 'home-note', starId: home.id, content: '这里是我家，我住在这里。' })],
    [nearRoute, farRoute],
  ), { query: '我家附近走过哪些路线', radiusKm: 2 });
  const unresolved = researchMemoryContext(memory([home], [], [nearRoute]), {
    query: '我家附近走过哪些路线',
    radiusKm: 2,
  });
  const ambiguous = researchMemoryContext(memory(
    [home, secondHome],
    [
      note({ id: 'home-a', starId: home.id, content: '这里是我家。' }),
      note({ id: 'home-b', starId: secondHome.id, content: '这里是我家。' }),
    ],
    [nearRoute, farRoute],
  ), { query: '我家附近走过哪些路线', radiusKm: 2 });

  assert.deepEqual(resolved.selectedTrackIds, ['near-route']);
  assert.deepEqual(unresolved.selectedTrackIds, []);
  assert.deepEqual(ambiguous.selectedTrackIds, []);
});

test('work-nearby route intent spatially filters routes without using routes as identity evidence', () => {
  const office = star('office', 31.2, 121.4);
  const nearRoute = track('work-run', '2026-01-02', [[31.2, 121.4], [31.206, 121.405]]);
  const farRoute = track('other-run', '2026-01-02', [[30.2, 120.4], [30.206, 120.405]]);
  const result = researchMemoryContext(memory(
    [office],
    [note({ id: 'office-note', starId: office.id, content: '我在这里工作。' })],
    [nearRoute, farRoute],
  ), { query: '我工作地点附近的跑步路线', radiusKm: 2 });

  assert.equal(result.personalContext.status, 'resolved');
  assert.deepEqual(result.selectedTrackIds, ['work-run']);
  assert.deepEqual(result.selectedNoteIds, []);
});

test('evidence selection is stable under reordering and unrelated additions', () => {
  const home = star('home', 31.2, 121.4);
  const target = star('target', 31.204, 121.404);
  const unrelated = star('unrelated', 30.2, 120.4, '2026-07-10');
  const homeNote = note({ id: 'home-note', starId: home.id, content: '这里是我家。' });
  const targetNote = note({ id: 'target-note', starId: target.id, content: '我在这里看到了海豚。' });
  const extra = note({ id: 'extra', starId: unrelated.id, createdAt: '2026-07-10', content: '最近的普通记录。' });
  const query = { query: '我家附近在哪里看到过海豚？', radiusKm: 2 };
  const first = researchMemoryContext(memory([home, target], [homeNote, targetNote]), query);
  const reordered = researchMemoryContext(memory(
    [unrelated, target, home],
    [extra, targetNote, homeNote],
  ), query);

  assert.deepEqual(reordered.selectedNoteIds, first.selectedNoteIds);
  assert.deepEqual(
    reordered.evidencePassages.map(passage => [passage.noteId, passage.role]),
    first.evidencePassages.map(passage => [passage.noteId, passage.role]),
  );
});
