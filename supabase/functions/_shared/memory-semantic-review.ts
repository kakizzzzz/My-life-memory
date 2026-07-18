import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
} from './memory-record-types.ts';
import {
  buildHostReviewedEvidencePassage,
  memoryNoteContainsExactQuote,
  memoryNoteContainsLiteralTarget,
  type MemoryEvidencePassage,
  type PersonalAnchorEpisode,
  type PersonalAnchorRelation,
  type PersonalContextRelation,
  type PersonalContextResolution,
  type SmallArchiveReview,
} from './memory-personal-context.ts';
import type { MemoryQueryPlan } from './memory-query-plan.ts';

const MAX_REVIEW_DECISIONS = 6;

export type MemorySemanticReviewDecision = {
  noteId: string;
  verdict: 'supports' | 'rejects' | 'uncertain';
  relation: PersonalContextRelation;
  evidenceQuote: string;
};

export type MemorySemanticReviewInput = {
  requestCandidates?: boolean;
  candidateOffset?: number;
  decisions?: MemorySemanticReviewDecision[];
};

export type MemorySemanticReviewDecisionResult = MemorySemanticReviewDecision & {
  accepted: boolean;
  disposition: 'evidence' | 'clarification' | 'rejected' | 'invalid';
  reason: string;
};

export type MemorySemanticReviewState = {
  required: boolean;
  phase: 'not-needed' | 'candidate-access-required' | 'awaiting-host-review' | 'clarification-needed' | 'review-complete' | 'review-invalid';
  usesExternalModelService: false;
  candidatesExposed: boolean;
  totalCandidateCount: number;
  totalCandidatePassageCount: number;
  reviewableCandidatePassageCount: number;
  reviewTruncated: boolean;
  candidateOffset: number;
  nextCandidateOffset: number | null;
  candidateNoteIds: string[];
  allowedRelations: PersonalContextRelation[];
  decisions: MemorySemanticReviewDecisionResult[];
  clarification: {
    required: true;
    reason: 'uncertain-candidate' | 'review-exhausted';
    allowedUse: 'clarification-only';
    candidateNoteIds: string[];
    candidateQuotes: string[];
    suggestedQuestion: string;
  } | null;
  instruction: string;
};

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .replace(/…$/u, '')
  .trim();

const unique = <T,>(values: T[]) => [...new Set(values)];

const allowedRelationsFor = (plan: MemoryQueryPlan): PersonalContextRelation[] => unique([
  ...plan.anchorRelations,
  ...plan.eventRelations,
  ...(plan.targetTerms.length > 0 && plan.eventRelations.length === 0 ? ['activity' as const] : []),
]);

const radians = (degrees: number) => degrees * Math.PI / 180;
const distanceKm = (left: { lat: number; lng: number }, right: { lat: number; lng: number }) => {
  const deltaLat = radians(right.lat - left.lat);
  const deltaLng = radians(right.lng - left.lng);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
};

const clarificationQuestion = (query: string, quote = '') => {
  const boundedQuote = quote.slice(0, 180).trim();
  if (/\p{Script=Hangul}/u.test(query)) {
    return boundedQuote
      ? `말씀하신 대상이나 경험이 이 기록을 뜻하나요? “${boundedQuote}” 아니라면 대략적인 시간, 장소, 제목 단어 또는 당시 한 일을 알려 주세요.`
      : '아직 질문을 뒷받침하는 기록을 확인하지 못했습니다. 대략적인 시간, 장소, 제목 단어 또는 당시 한 일을 더 알려 주세요.';
  }
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) {
    return boundedQuote
      ? `お探しの対象や出来事は、この記録のことですか？「${boundedQuote}」違う場合は、おおよその時期、場所、タイトルの言葉、または当時したことを教えてください。`
      : '質問を裏付ける記録をまだ確認できません。おおよその時期、場所、タイトルの言葉、または当時したことを追加してください。';
  }
  if (/\p{Script=Han}/u.test(query)) {
    return boundedQuote
      ? `你说的对象或经历是在指这条记录吗？“${boundedQuote}”如果不是，我暂时没有找到更匹配的证据；可以补充大致时间、地点、标题词，或你当时做了什么。`
      : '我暂时没有找到能完整支持这个问题的记录。可以补充大致时间、地点、标题词，或你当时做了什么。';
  }
  return boundedQuote
    ? `Do you mean the object or experience in this saved passage: “${boundedQuote}”? If not, add an approximate time, place, title word, or what you were doing.`
    : 'I could not verify a saved memory that fully answers this question. Add an approximate time, place, title word, or what you were doing.';
};

const resolutionFromReviewedPassages = (
  base: PersonalContextResolution,
  plan: MemoryQueryPlan,
  passages: MemoryEvidencePassage[],
  starById: Map<string, StarRow>,
): PersonalContextResolution => {
  const anchorReview = plan.anchorRelations.length > 0;
  const anchorPassages = passages.filter(passage => (
    passage.relation === 'home' || passage.relation === 'work' || passage.relation === 'study'
  ));
  const eventPassages = passages.filter(passage => (
    passage.relation === 'observation' || passage.relation === 'activity'
  ));
  if (anchorReview && !anchorPassages.length) return base;
  const groupingPassages = anchorReview ? anchorPassages : eventPassages;
  const grouped = new Map<string, MemoryEvidencePassage[]>();
  groupingPassages.forEach(passage => {
    grouped.set(passage.starId, [...(grouped.get(passage.starId) || []), passage]);
  });
  const selectedGroups = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const ambiguous = anchorReview && selectedGroups.length > 1;
  const groupedPassages = selectedGroups.flatMap(([, items]) => items);
  const selectedAnchor = !ambiguous && anchorReview ? selectedGroups[0] : null;
  const anchorCoordinate = selectedAnchor ? starById.get(selectedAnchor[0]) : null;
  const scopedEventPassages = anchorCoordinate ? eventPassages.filter(passage => {
    const eventStar = starById.get(passage.starId);
    if (!eventStar) return false;
    const maximumDistance = base.proximityRequested ? base.radiusKm : 0.05;
    return distanceKm(
      { lat: anchorCoordinate.lat, lng: anchorCoordinate.lng },
      { lat: eventStar.lat, lng: eventStar.lng },
    ) <= maximumDistance;
  }) : anchorReview ? [] : eventPassages;
  const selectedPassages = unique([
    ...groupedPassages,
    ...scopedEventPassages,
  ]).slice(0, 12);
  const anchors = selectedGroups.flatMap(([starId, items]) => {
    const star = starById.get(starId);
    const passage = items[0];
    if (!star || !passage) return [];
    return [{
      starId,
      noteId: passage.noteId,
      coordinates: { lat: star.lat, lng: star.lng },
      createdAt: passage.createdAt,
      score: 5,
      matchedRelations: unique(items.map(item => item.relation)),
      matchedTerms: unique(items.flatMap(item => item.matchedTerms)),
    }];
  });
  const episodes: PersonalAnchorEpisode[] = anchorReview ? selectedGroups.flatMap(([starId, items]) => {
    const timestamps = items.map(item => Number(item.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
    const relation = items[0]?.relation;
    if (relation !== 'home' && relation !== 'work' && relation !== 'study') return [];
    return [{
      relation: relation as PersonalAnchorRelation,
      starId,
      evidenceNoteIds: unique(items.map(item => item.noteId)),
      firstEvidenceAt: timestamps[0] ?? null,
      lastEvidenceAt: timestamps.at(-1) ?? null,
      evidenceStrength: 'corroborated',
    }];
  }) : [];
  const sources = new Set(selectedPassages.map(passage => passage.source));
  const matchSource = sources.size > 1 ? 'mixed' : sources.has('title') ? 'title' : 'content';
  const confidence = ambiguous ? 0.48 : 0.58;
  return {
    ...base,
    status: ambiguous ? 'ambiguous' : 'resolved',
    confidence,
    confidenceBand: 'low',
    matchSource,
    anchors,
    episodes,
    evidencePassages: selectedPassages,
    evidenceNoteIds: unique(selectedPassages.map(passage => passage.noteId)),
    decisionReasons: ambiguous
      ? ['The host AI found exact supporting quotes at multiple candidate locations; no location was selected by recency.']
      : [
          'The deterministic layer found no answer; the host AI selected an exact candidate quote and the server validated ownership, quotation, and hard safety rules.',
          ...(anchorReview && eventPassages.length > scopedEventPassages.length
            ? ['Host-reviewed event passages outside the resolved personal spatial scope were excluded.']
            : []),
        ],
    instruction: ambiguous
      ? 'The host-assisted review remains ambiguous. Ask the user to disambiguate and do not state coordinates.'
      : 'This is a low-confidence host-assisted interpretation of an exact saved passage. Quote the passage and describe the result as an inference, not a verified identity fact.',
  };
};

export const applyMemorySemanticReview = ({
  memory,
  queryPlan,
  baseResolution,
  candidateReview,
  input,
}: {
  memory: NormalizedMemoryRows;
  queryPlan: MemoryQueryPlan;
  baseResolution: PersonalContextResolution;
  candidateReview: SmallArchiveReview;
  input?: MemorySemanticReviewInput | null;
}) => {
  const allowedRelations = allowedRelationsFor(queryPlan);
  if (baseResolution.status !== 'not-found' || !candidateReview.available || !allowedRelations.length) {
    return {
      resolution: baseResolution,
      state: {
        required: false,
        phase: 'not-needed',
        usesExternalModelService: false,
        candidatesExposed: false,
        totalCandidateCount: 0,
        totalCandidatePassageCount: 0,
        reviewableCandidatePassageCount: 0,
        reviewTruncated: false,
        candidateOffset: 0,
        nextCandidateOffset: null,
        candidateNoteIds: [],
        allowedRelations,
        decisions: [],
        clarification: null,
        instruction: 'The deterministic evidence layer completed the request; no semantic fallback is needed.',
      } satisfies MemorySemanticReviewState,
    };
  }

  const decisions = Array.isArray(input?.decisions)
    ? input.decisions.slice(0, MAX_REVIEW_DECISIONS)
    : [];
  if (!decisions.length) {
    const hasCandidates = candidateReview.totalCandidateCount > 0;
    const candidatesExposed = Boolean(input?.requestCandidates && candidateReview.candidateNoteIds.length);
    return {
      resolution: baseResolution,
      state: {
        required: hasCandidates,
        phase: hasCandidates
          ? candidatesExposed ? 'awaiting-host-review' : 'candidate-access-required'
          : 'not-needed',
        usesExternalModelService: false,
        candidatesExposed,
        totalCandidateCount: candidateReview.totalCandidateCount,
        totalCandidatePassageCount: candidateReview.totalCandidatePassageCount,
        reviewableCandidatePassageCount: candidateReview.reviewableCandidatePassageCount,
        reviewTruncated: candidateReview.reviewTruncated,
        candidateOffset: candidateReview.candidateOffset,
        nextCandidateOffset: hasCandidates
          ? candidatesExposed ? candidateReview.nextCandidateOffset : 0
          : null,
        candidateNoteIds: candidatesExposed ? candidateReview.candidateNoteIds : [],
        allowedRelations,
        decisions: [],
        clarification: null,
        instruction: !hasCandidates
          ? 'No bounded candidate is available. State that the archive does not contain enough supporting evidence.'
          : candidatesExposed
            ? 'Do not answer from candidateNotes. Use the conversation model to compare meanings, aliases, nicknames, implicit descriptions, and requested relations. Submit supports only when an exact quote entails the question; submit uncertain when it is merely plausible and should become a clarification question; submit rejects for unrelated text. Call research_memory_context again with the same query, this candidateOffset, and exact-quote decisions. If this batch has no support and nextCandidateOffset is not null, continue with that offset. My Life Memory does not run a model service.'
            : 'Do not answer yet. Candidate text is deliberately withheld from this first response. If the AI application supports multi-step tool use, call research_memory_context again with the same query and semanticReview.requestCandidates=true, candidateOffset=0. Otherwise state that the archive does not contain enough verified evidence.',
      } satisfies MemorySemanticReviewState,
    };
  }

  const noteById = new Map(memory.notes.map(note => [note.id, note]));
  const starById = new Map(memory.stars.map(star => [star.id, star]));
  const seen = new Set<string>();
  const acceptedPassages: MemoryEvidencePassage[] = [];
  const uncertainDecisions: MemorySemanticReviewDecision[] = [];
  const results: MemorySemanticReviewDecisionResult[] = decisions.map(rawDecision => {
    const decision: MemorySemanticReviewDecision = {
      noteId: String(rawDecision?.noteId || '').trim(),
      verdict: rawDecision?.verdict,
      relation: rawDecision?.relation,
      evidenceQuote: String(rawDecision?.evidenceQuote || '').trim(),
    };
    const decisionKey = `${decision.noteId}:${decision.relation}:${normalize(decision.evidenceQuote)}`;
    const duplicate = seen.has(decisionKey);
    seen.add(decisionKey);
    if (duplicate) return { ...decision, accepted: false, disposition: 'invalid' as const, reason: 'Duplicate candidate decision.' };
    if (!allowedRelations.includes(decision.relation)) {
      return { ...decision, accepted: false, disposition: 'invalid' as const, reason: 'The reviewed relation was not requested by the query.' };
    }
    const note = noteById.get(decision.noteId) as NoteRow | undefined;
    const star = note ? starById.get(note.star_id) : undefined;
    if (!note || !star) return { ...decision, accepted: false, disposition: 'invalid' as const, reason: 'The authenticated note or star no longer exists.' };
    if (!memoryNoteContainsExactQuote(note, decision.evidenceQuote)) {
      return { ...decision, accepted: false, disposition: 'invalid' as const, reason: 'The exact quote is not present in the authenticated note.' };
    }
    if (decision.verdict === 'rejects') {
      return { ...decision, accepted: false, disposition: 'rejected' as const, reason: 'The host AI rejected this candidate.' };
    }
    if (decision.verdict === 'uncertain') {
      uncertainDecisions.push(decision);
      return { ...decision, accepted: false, disposition: 'clarification' as const, reason: 'The candidate is plausible but not strong enough to become evidence.' };
    }
    const eventRelation = decision.relation === 'observation' || decision.relation === 'activity';
    if (eventRelation && queryPlan.targetTerms.length > 0
      && !memoryNoteContainsLiteralTarget(note, queryPlan.targetTerms)) {
      uncertainDecisions.push(decision);
      return {
        ...decision,
        accepted: false,
        disposition: 'clarification' as const,
        reason: 'The host proposed a semantic alias, but the saved note has no literal target bridge; user confirmation is required before it can become evidence.',
      };
    }
    const reviewed = buildHostReviewedEvidencePassage({
      note,
      star,
      relation: decision.relation,
      evidenceQuote: decision.evidenceQuote,
      matchedTerms: [...queryPlan.targetTerms, ...queryPlan.actionTerms],
    });
    if (!reviewed.accepted || !reviewed.passage) {
      return { ...decision, accepted: false, disposition: 'invalid' as const, reason: reviewed.reason };
    }
    acceptedPassages.push(reviewed.passage);
    return { ...decision, accepted: true, disposition: 'evidence' as const, reason: reviewed.reason };
  });

  const resolution = acceptedPassages.length
    ? resolutionFromReviewedPassages(baseResolution, queryPlan, acceptedPassages, starById)
    : baseResolution;
  const invalid = results.some(result => result.disposition === 'invalid');
  const selectedRelations = new Set(resolution.evidencePassages.map(passage => passage.relation));
  const anchorSatisfied = queryPlan.anchorRelations.length === 0
    || queryPlan.anchorRelations.some(relation => selectedRelations.has(relation));
  const eventRelations = queryPlan.eventRelations.length
    ? queryPlan.eventRelations
    : queryPlan.targetTerms.length > 0 ? ['activity' as const] : [];
  const eventSatisfied = eventRelations.length === 0
    || eventRelations.some(relation => selectedRelations.has(relation));
  const reviewComplete = resolution.status !== 'not-found' && anchorSatisfied && eventSatisfied;
  const canContinue = candidateReview.nextCandidateOffset !== null;
  const needsMoreCandidates = !reviewComplete && !invalid && uncertainDecisions.length === 0 && canContinue;
  // Invalid `supports` submissions are protocol failures, not ambiguity. Turning
  // them into a clarification would let a rejected passage influence the reply.
  const needsClarification = !reviewComplete && !invalid && !needsMoreCandidates;
  const clarification = needsClarification ? {
    required: true as const,
    reason: uncertainDecisions.length ? 'uncertain-candidate' as const : 'review-exhausted' as const,
    allowedUse: 'clarification-only' as const,
    candidateNoteIds: unique(uncertainDecisions.map(decision => decision.noteId)),
    candidateQuotes: unique(uncertainDecisions.map(decision => decision.evidenceQuote)).slice(0, 2),
    suggestedQuestion: clarificationQuestion(queryPlan.originalQuery, uncertainDecisions[0]?.evidenceQuote),
  } : null;
  return {
    resolution,
    state: {
      required: needsMoreCandidates,
      phase: reviewComplete
        ? 'review-complete'
        : invalid
          ? 'review-invalid'
          : needsMoreCandidates
            ? 'candidate-access-required'
            : 'clarification-needed',
      usesExternalModelService: false,
      candidatesExposed: false,
      totalCandidateCount: candidateReview.totalCandidateCount,
      totalCandidatePassageCount: candidateReview.totalCandidatePassageCount,
      reviewableCandidatePassageCount: candidateReview.reviewableCandidatePassageCount,
      reviewTruncated: candidateReview.reviewTruncated,
      candidateOffset: candidateReview.candidateOffset,
      nextCandidateOffset: candidateReview.nextCandidateOffset,
      candidateNoteIds: [],
      allowedRelations,
      decisions: results,
      clarification,
      instruction: reviewComplete
        ? resolution.instruction
        : needsMoreCandidates
          ? `Do not answer yet. Request the next bounded candidate batch with semanticReview.requestCandidates=true and candidateOffset=${candidateReview.nextCandidateOffset}. Keep any earlier exact-quote decisions and resubmit all supporting decisions only after the required anchor and event evidence are both found.`
          : clarification?.suggestedQuestion || 'No reviewed candidate passed the server checks. State that no supporting memory was found; do not substitute another location.',
    } satisfies MemorySemanticReviewState,
  };
};
