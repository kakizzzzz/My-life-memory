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

test('body-only domestic context can establish home without a matching title', () => {
  const place = star('body-home', 31.2, 121.4);
  const result = researchMemoryContext(memory(
    [place],
    [note({
      id: 'body-home-note',
      starId: place.id,
      title: '搬来的第一周',
      content: '搬到这里以后，我们住进了这套房子，终于慢慢安定下来了。',
    })],
  ), { query: '我家在哪里？' });

  assert.equal(result.personalContext.status, 'resolved');
  assert.deepEqual(result.selectedNoteIds, ['body-home-note']);
  assert.equal(result.answerBoundary.status, 'supported');
  assert.equal(result.answerBoundary.exactPersonalAnchorQuestion, true);
  assert.equal(result.answerBoundary.placeNamePolicy, 'explicit-evidence-only');
  assert.deepEqual(result.answerBoundary.verifiedPlaceNames, []);
  assert.match(result.answerBoundary.suggestedReply, /不要补充城市、街区、建筑或地址/u);
});

test('colloquial exact-anchor wording resolves body evidence without inventing a place name', () => {
  const home = star('colloquial-home', 31.2, 121.4);
  const result = researchMemoryContext(memory(
    [home],
    [note({ id: 'colloquial-home-note', starId: home.id, content: '搬到这里后，我们住进了这套房子。' })],
  ), { query: '我家在哪' });

  assert.equal(result.queryPlan.answerIntent, 'locate');
  assert.equal(result.answerBoundary.exactPersonalAnchorQuestion, true);
  assert.equal(result.answerBoundary.mandatory, true);
  assert.equal(result.answerBoundary.answerMode, 'evidence-only');
  assert.equal(result.answerBoundary.mustUseSuggestedReply, false);
  assert.deepEqual(result.answerBoundary.allowedEvidenceNoteIds, ['colloquial-home-note']);
  assert.deepEqual(result.answerBoundary.verifiedPlaceNames, []);
});

test('work and study anchors accept explicit first-person body evidence', () => {
  const office = star('desk', 31.2, 121.4);
  const school = star('classroom', 31.3, 121.5);
  const archive = memory(
    [office, school],
    [
      note({ id: 'desk-note', starId: office.id, content: '这是我的工位，我每天在这里上班。' }),
      note({ id: 'class-note', starId: school.id, content: '这是我的教室，我每天在这里上课。' }),
    ],
  );

  assert.deepEqual(researchMemoryContext(archive, { query: '我工作在哪' }).selectedStarIds, ['desk']);
  assert.deepEqual(researchMemoryContext(archive, { query: '我学习的地方在哪' }).selectedStarIds, ['classroom']);
});

test('negated observations do not become evidence while later positive clauses still can', () => {
  const negative = star('negative-observation', 31.2, 121.4);
  const mixed = star('mixed-observation', 31.3, 121.5);
  const archive = memory(
    [negative, mixed],
    [
      note({ id: 'negative-note', starId: negative.id, content: '我没有看到蓝色的鸟。' }),
      note({ id: 'mixed-note', starId: mixed.id, content: '一开始没看到蓝色的鸟，但是后来我看到了蓝色的鸟。' }),
    ],
  );
  const result = researchMemoryContext(archive, { query: '我在哪见过那只蓝色的鸟' });

  assert.deepEqual(result.queryPlan.eventRelations, ['observation']);
  assert.deepEqual(result.queryPlan.targetTerms, ['蓝色', '鸟']);
  assert.deepEqual(result.selectedNoteIds, ['mixed-note']);
  assert.equal(result.evidencePassages.every(passage => !passage.negated), true);
});

test('generic object pointers do not hide the target in first-person observation queries', () => {
  const building = star('blue-building', 31.2, 121.4);
  const unrelated = star('unrelated-building', 31.3, 121.5);
  const archive = memory(
    [building, unrelated],
    [
      note({ id: 'blue-building-note', starId: building.id, content: '散步时我看到了那栋蓝色房子。' }),
      note({ id: 'unrelated-building-note', starId: unrelated.id, content: '这里有一栋普通房子。' }),
    ],
  );
  const result = researchMemoryContext(archive, { query: '我看到的一个蓝色房子在哪里？' });

  assert.deepEqual(result.queryPlan.anchorRelations, []);
  assert.deepEqual(result.queryPlan.eventRelations, ['observation']);
  assert.deepEqual(result.queryPlan.targetTerms, ['蓝色房子']);
  assert.deepEqual(result.selectedNoteIds, ['blue-building-note']);
  assert.equal(result.answerBoundary.status, 'supported');
});

test('generic activity objects use the same evidence path without a personal anchor', () => {
  const fabricShop = star('fabric-shop', 31.2, 121.4);
  const cafe = star('cafe', 31.3, 121.5);
  const result = researchMemoryContext(memory(
    [fabricShop, cafe],
    [
      note({ id: 'fabric-note', starId: fabricShop.id, content: '我在这里买过蓝色布料。' }),
      note({ id: 'coffee-note', starId: cafe.id, content: '我在这里买过咖啡。' }),
    ],
  ), { query: '我在哪买过一块蓝色布料？' });

  assert.deepEqual(result.queryPlan.anchorRelations, []);
  assert.deepEqual(result.queryPlan.eventRelations, ['activity']);
  assert.deepEqual(result.queryPlan.targetTerms, ['蓝色布料']);
  assert.deepEqual(result.selectedNoteIds, ['fabric-note']);
});

test('weak home wording remains review-only and cannot authorize a location answer', () => {
  const possible = star('possible-home', 31.2, 121.4);
  const result = researchMemoryContext(memory(
    [possible],
    [note({
      id: 'possible-home-note',
      starId: possible.id,
      title: '河边散步',
      content: '我家附近有一条河，但这句话没有说明这个星标就是我家。',
    })],
  ), { query: '我家在哪里？' });

  assert.equal(result.personalContext.status, 'not-found');
  assert.deepEqual(result.selectedNoteIds, []);
  assert.deepEqual(result.selectedStarIds, []);
  assert.deepEqual(result.candidateNoteIds, ['possible-home-note']);
  assert.equal(result.answerBoundary.status, 'not-found');
  assert.equal(result.answerBoundary.mandatory, true);
  assert.equal(result.answerBoundary.answerMode, 'state-no-answer');
  assert.equal(result.answerBoundary.mustUseSuggestedReply, true);
  assert.equal(result.answerBoundary.mayUseCandidateNotesAsAnswer, false);
  assert.equal(result.answerBoundary.mayStateCoordinates, false);
  assert.match(result.answerBoundary.suggestedReply, /没有足够的第一人称证据/u);
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
  assert.equal(undated.answerBoundary.status, 'ambiguous');
  assert.equal(undated.answerBoundary.mayStateCoordinates, false);
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

test('study-nearby activity queries compose an anchor with a fuzzy photographed object', () => {
  const classroom = star('study-anchor', 31.2, 121.4);
  const sunset = star('sunset-photo', 31.204, 121.404);
  const distantSunset = star('distant-sunset', 30.2, 120.4);
  const result = researchMemoryContext(memory(
    [classroom, sunset, distantSunset],
    [
      note({ id: 'study-note', starId: classroom.id, content: '这是我的教室，我每天在这里上课。' }),
      note({ id: 'sunset-note', starId: sunset.id, content: '放学后我在这里拍了一张粉色晚霞。' }),
      note({ id: 'far-sunset-note', starId: distantSunset.id, content: '我在这里拍了一张粉色晚霞。' }),
    ],
  ), { query: '我学习的地方附近拍过的一个粉色晚霞在哪里？', radiusKm: 2 });

  assert.equal(result.personalContext.status, 'resolved');
  assert.deepEqual(result.queryPlan.anchorRelations, ['study']);
  assert.deepEqual(result.queryPlan.eventRelations, ['activity']);
  assert.deepEqual(result.queryPlan.targetTerms, ['粉色晚霞']);
  assert.deepEqual(result.selectedNoteIds, ['sunset-note']);
});

test('an unresolved fuzzy workplace never returns an unrelated recent memory', () => {
  const companyVisit = star('company-visit-only', 31.2, 121.4);
  const recent = star('recent-noise', 31.3, 121.5, '2026-07-10');
  const result = researchMemoryContext(memory(
    [companyVisit, recent],
    [
      note({ id: 'visit-note', starId: companyVisit.id, content: '今天参观了一家公司。' }),
      note({ id: 'recent-note', starId: recent.id, createdAt: '2026-07-10', content: '最近拍了一张普通照片。' }),
    ],
  ), { query: '我工作的地方在哪？' });

  assert.equal(result.personalContext.status, 'not-found');
  assert.deepEqual(result.selectedNoteIds, []);
  assert.deepEqual(result.selectedStarIds, []);
  assert.equal(result.answerBoundary.mustUseSuggestedReply, true);
  assert.equal(result.latestRecordedMemory, null);
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
