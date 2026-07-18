import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMemoryResearchDisclosureBoundary } from '../supabase/functions/_shared/memory-public-response.ts';
import { analyzePersonalContextQuery } from '../supabase/functions/_shared/memory-personal-context.ts';
import { researchMemoryContext } from '../supabase/functions/_shared/memory-research.ts';
import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
} from '../supabase/functions/_shared/memory-record-types.ts';

const createdAt = Date.parse('2026-01-01T12:00:00Z');

const star = (id: string, lat = 31.2, lng = 121.4): StarRow => ({
  id,
  sort_order: 0,
  lat,
  lng,
  created_at_ms: createdAt,
  tag_order: null,
  tag_group_id: null,
  color: '#cccccc',
});

const note = (id: string, starId: string, content: string, title = ''): NoteRow => ({
  star_id: starId,
  id,
  sort_order: 0,
  title,
  title_html: title ? `<p>${title}</p>` : '',
  content,
  content_html: `<p>${content}</p>`,
  image_url: null,
  image_urls: [],
  images: [],
  font_size: null,
  title_font_size: null,
  color: null,
  created_at_ms: createdAt,
  updated_at_ms: createdAt,
});

const memory = (stars: StarRow[], notes: NoteRow[]): NormalizedMemoryRows => ({
  userId: 'user-1',
  account: 'owner',
  profile: null,
  revision: 1,
  stars,
  notes,
  tracks: [],
});

const publicResult = (value: ReturnType<typeof researchMemoryContext>) => (
  applyMemoryResearchDisclosureBoundary(value as unknown as Record<string, unknown>)
);

test('unresolved research requires an explicit candidate request before exposing passages', () => {
  const place = star('alias-place');
  const archive = memory(
    [place],
    [note('alias-note', place.id, '团团趴在窗边晒了一下午。', '平静午后')],
  );
  const first = researchMemoryContext(archive, { query: '我在哪里见过那只猫？' });

  assert.equal(first.semanticReview.phase, 'candidate-access-required');
  assert.equal(first.semanticReview.candidatesExposed, false);
  assert.deepEqual(first.semanticReview.candidateNoteIds, []);
  assert.equal(first.answerBoundary.status, 'needs-candidate-review');
  assert.deepEqual(publicResult(first).candidateNoteIds, []);
  assert.deepEqual(
    (publicResult(first).candidateReview as { candidateExcerpts: unknown[] }).candidateExcerpts,
    [],
  );

  const batch = researchMemoryContext(archive, {
    query: '我在哪里见过那只猫？',
    semanticReview: { requestCandidates: true, candidateOffset: 0 },
  });
  const disclosedBatch = publicResult(batch);

  assert.equal(batch.semanticReview.phase, 'awaiting-host-review');
  assert.equal(batch.semanticReview.candidatesExposed, true);
  assert.equal(batch.candidateReview.candidateExcerpts.length > 0, true);
  assert.equal(
    (disclosedBatch.candidateReview as { candidateExcerpts: unknown[] }).candidateExcerpts.length > 0,
    true,
  );
  assert.deepEqual(batch.selectedNoteIds, []);
  assert.equal(batch.answerBoundary.mayStateCoordinates, false);
});

test('a plausible nickname without a literal target bridge becomes clarification, not evidence', () => {
  const place = star('nickname-place');
  const quote = '团团趴在窗边晒了一下午。';
  const result = researchMemoryContext(memory(
    [place],
    [note('nickname-note', place.id, quote, '平静午后')],
  ), {
    query: '我在哪里见过那只猫？',
    semanticReview: {
      candidateOffset: 0,
      decisions: [{
        noteId: 'nickname-note',
        verdict: 'supports',
        relation: 'observation',
        evidenceQuote: quote,
      }],
    },
  });

  assert.equal(result.semanticReview.phase, 'clarification-needed');
  assert.equal(result.semanticReview.decisions[0].disposition, 'clarification');
  assert.match(result.semanticReview.decisions[0].reason, /literal target bridge/u);
  assert.equal(result.answerBoundary.status, 'ambiguous');
  assert.equal(result.answerBoundary.requiredAction, 'ask-for-disambiguation');
  assert.equal(result.answerBoundary.mayStateCoordinates, false);
  assert.deepEqual(result.selectedNoteIds, []);
  assert.deepEqual(publicResult(result).selectedStarIds, []);
});

test('semantic uncertainty produces a localized clarification without becoming evidence', () => {
  const cases = [
    {
      query: 'Where did I see the animal?',
      quote: 'Pip was resting beside the window.',
      expected: /Do you mean/u,
    },
    {
      query: 'あの動物を見た場所はどこ？',
      quote: 'ピピは窓のそばで休んでいた。',
      expected: /この記録/u,
    },
    {
      query: '그 동물을 어디에서 봤지?',
      quote: '삐삐는 창가에서 쉬고 있었다.',
      expected: /이 기록/u,
    },
  ];

  cases.forEach(({ query, quote, expected }, index) => {
    const place = star(`localized-place-${index}`);
    const noteId = `localized-note-${index}`;
    const result = researchMemoryContext(memory(
      [place],
      [note(noteId, place.id, quote, 'A quiet moment')],
    ), {
      query,
      semanticReview: {
        candidateOffset: 0,
        decisions: [{
          noteId,
          verdict: 'uncertain',
          relation: 'observation',
          evidenceQuote: quote,
        }],
      },
    });

    assert.equal(result.semanticReview.phase, 'clarification-needed', query);
    assert.match(result.semanticReview.clarification?.suggestedQuestion || '', expected);
    assert.equal(result.answerBoundary.mayStateCoordinates, false);
    assert.deepEqual(result.selectedNoteIds, []);
  });
});

test('multilingual function words never become target evidence', () => {
  assert.deepEqual(analyzePersonalContextQuery('Where did I see the animal?').targetTerms, ['animal']);
  assert.deepEqual(analyzePersonalContextQuery('あの動物を見た場所はどこ？').targetTerms, ['動物']);
  assert.deepEqual(analyzePersonalContextQuery('그 동물을 어디에서 봤지?').targetTerms, ['동물']);

  const place = star('different-target-place');
  const result = researchMemoryContext(memory(
    [place],
    [note('different-target-note', place.id, 'I saw the mural beside the entrance.')],
  ), { query: 'Where did I see the animal?' });

  assert.equal(result.personalContext.status, 'not-found');
  assert.deepEqual(result.selectedNoteIds, []);
  assert.equal(result.answerBoundary.mayStateCoordinates, false);
});

test('host review may promote an exact stored target passage after server validation', () => {
  const place = star('verified-place');
  const quote = '团团是一只猫，那天它一直趴在窗边。';
  const result = researchMemoryContext(memory(
    [place],
    [note('verified-note', place.id, quote, '平静午后')],
  ), {
    query: '我在哪里见过那只猫？',
    semanticReview: {
      candidateOffset: 0,
      decisions: [{
        noteId: 'verified-note',
        verdict: 'supports',
        relation: 'observation',
        evidenceQuote: quote,
      }],
    },
  });

  assert.equal(result.semanticReview.phase, 'review-complete');
  assert.equal(result.semanticReview.decisions[0].disposition, 'evidence');
  assert.equal(result.answerBoundary.status, 'supported');
  assert.deepEqual(result.selectedNoteIds, ['verified-note']);
});

test('candidate passage pages are bounded, non-overlapping, and expose no records', () => {
  const stars = Array.from({ length: 9 }, (_, index) => star(`place-${index}`, 31.2 + index / 100, 121.4));
  const archive = memory(stars, stars.map((item, index) => (
    note(`note-${index}`, item.id, `第 ${index + 1} 条虚构测试片段。`)
  )));
  const firstPage = researchMemoryContext(archive, {
    query: '我在哪里见过那件不存在的纪念品？',
    semanticReview: { requestCandidates: true, candidateOffset: 0 },
  });
  const secondPage = researchMemoryContext(archive, {
    query: '我在哪里见过那件不存在的纪念品？',
    semanticReview: {
      requestCandidates: true,
      candidateOffset: firstPage.semanticReview.nextCandidateOffset || 0,
    },
  });
  const firstIds = new Set(firstPage.semanticReview.candidateNoteIds);
  const secondIds = new Set(secondPage.semanticReview.candidateNoteIds);

  assert.equal(firstPage.candidateReview.candidateExcerpts.length <= 4, true);
  assert.equal(secondPage.candidateReview.candidateExcerpts.length <= 4, true);
  assert.equal([...secondIds].some(id => firstIds.has(id)), false);
  assert.deepEqual(firstPage.selectedNoteIds, []);
  assert.deepEqual(secondPage.selectedNoteIds, []);
  assert.equal(firstPage.semanticReview.nextCandidateOffset, 4);
  assert.equal(secondPage.semanticReview.candidateOffset, 4);
});

test('anchor and target evidence must both pass before a nearby event may answer', () => {
  const anchor = star('anchor', 31.2, 121.4);
  const target = star('target', 31.204, 121.404);
  const distant = star('distant', 30.2, 120.4);
  const anchorQuote = '这里是我长期居住和生活的地方。';
  const targetQuote = '纸风筝挂在树梢上，我停下来看了很久。';
  const archive = memory(
    [anchor, target, distant],
    [
      note('anchor-note', anchor.id, anchorQuote),
      note('target-note', target.id, targetQuote),
      note('distant-note', distant.id, '纸风筝挂在远处的树上。'),
    ],
  );
  const anchorOnly = researchMemoryContext(archive, {
    query: '我住处附近在哪里见过纸风筝？',
    radiusKm: 2,
    semanticReview: {
      candidateOffset: 0,
      decisions: [{
        noteId: 'anchor-note',
        verdict: 'supports',
        relation: 'home',
        evidenceQuote: anchorQuote,
      }],
    },
  });

  assert.notEqual(anchorOnly.answerBoundary.status, 'supported');
  assert.equal(anchorOnly.answerBoundary.mayStateCoordinates, false);
  assert.deepEqual(anchorOnly.selectedNoteIds, []);

  const complete = researchMemoryContext(archive, {
    query: '我住处附近在哪里见过纸风筝？',
    radiusKm: 2,
    semanticReview: {
      candidateOffset: 0,
      decisions: [
        {
          noteId: 'anchor-note',
          verdict: 'supports',
          relation: 'home',
          evidenceQuote: anchorQuote,
        },
        {
          noteId: 'target-note',
          verdict: 'supports',
          relation: 'observation',
          evidenceQuote: targetQuote,
        },
      ],
    },
  });

  assert.equal(complete.answerBoundary.status, 'supported');
  assert.deepEqual(complete.selectedNoteIds, ['target-note']);
  assert.equal(complete.selectedNoteIds.includes('distant-note'), false);
  assert.equal(complete.evidencePassages.some(passage => passage.role === 'anchor'), true);
  assert.equal(complete.evidencePassages.some(passage => passage.role === 'target'), true);
});
