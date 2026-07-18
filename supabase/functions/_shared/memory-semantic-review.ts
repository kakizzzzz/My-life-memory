import type {
  NormalizedMemoryRows,
  NoteRow,
  StarRow,
} from './memory-record-types.ts';
import {
  buildHostReviewedEvidencePassage,
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
  decisions?: MemorySemanticReviewDecision[];
};

export type MemorySemanticReviewDecisionResult = MemorySemanticReviewDecision & {
  accepted: boolean;
  reason: string;
};

export type MemorySemanticReviewState = {
  required: boolean;
  phase: 'not-needed' | 'awaiting-host-review' | 'review-complete' | 'review-invalid';
  usesExternalModelService: false;
  candidateNoteIds: string[];
  allowedRelations: PersonalContextRelation[];
  decisions: MemorySemanticReviewDecisionResult[];
  instruction: string;
};

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/\s+/g, ' ')
  .replace(/…$/u, '')
  .trim();

const unique = <T,>(values: T[]) => [...new Set(values)];

const allowedRelationsFor = (plan: MemoryQueryPlan): PersonalContextRelation[] => (
  plan.anchorRelations.length
    ? plan.anchorRelations
    : plan.eventRelations.length
      ? plan.eventRelations
      : []
);

const quoteAppearsInCandidate = (quote: string, excerpts: string[]) => {
  const normalizedQuote = normalize(quote);
  return Boolean(normalizedQuote) && excerpts.some(excerpt => normalize(excerpt).includes(normalizedQuote));
};

const resolutionFromReviewedPassages = (
  base: PersonalContextResolution,
  passages: MemoryEvidencePassage[],
  starById: Map<string, StarRow>,
): PersonalContextResolution => {
  const anchorReview = base.anchorRelations.length > 0;
  const grouped = new Map<string, MemoryEvidencePassage[]>();
  passages.forEach(passage => {
    grouped.set(passage.starId, [...(grouped.get(passage.starId) || []), passage]);
  });
  const selectedGroups = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const ambiguous = anchorReview && selectedGroups.length > 1;
  const selectedPassages = selectedGroups.flatMap(([, items]) => items).slice(0, 12);
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
      : ['The deterministic layer found no answer; the host AI selected an exact candidate quote and the server validated its scope and hard safety rules.'],
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
        candidateNoteIds: [],
        allowedRelations,
        decisions: [],
        instruction: 'The deterministic evidence layer completed the request; no semantic fallback is needed.',
      } satisfies MemorySemanticReviewState,
    };
  }

  const decisions = Array.isArray(input?.decisions)
    ? input.decisions.slice(0, MAX_REVIEW_DECISIONS)
    : [];
  if (!decisions.length) return {
    resolution: baseResolution,
    state: {
      required: candidateReview.candidateNoteIds.length > 0,
      phase: candidateReview.candidateNoteIds.length ? 'awaiting-host-review' : 'not-needed',
      usesExternalModelService: false,
      candidateNoteIds: candidateReview.candidateNoteIds,
      allowedRelations,
      decisions: [],
      instruction: candidateReview.candidateNoteIds.length
        ? 'Do not answer yet. candidateNotes are unverified review aids, not evidence. The AI application already handling the conversation may inspect only those bounded passages, classify them semantically, then call research_memory_context again with the same query and semanticReview.decisions. My Life Memory does not run a model service. A supports decision must include an exact quote. Temporary lodging, visits, negation, third-party places, and uncertainty must be rejects or uncertain.'
        : 'No plausible bounded candidate is available. State that the archive does not contain enough supporting evidence.',
    } satisfies MemorySemanticReviewState,
  };

  const candidateById = new Map(candidateReview.candidateExcerpts.map(candidate => [candidate.noteId, candidate]));
  const noteById = new Map(memory.notes.map(note => [note.id, note]));
  const starById = new Map(memory.stars.map(star => [star.id, star]));
  const seen = new Set<string>();
  const acceptedPassages: MemoryEvidencePassage[] = [];
  const results: MemorySemanticReviewDecisionResult[] = decisions.map(rawDecision => {
    const decision: MemorySemanticReviewDecision = {
      noteId: String(rawDecision?.noteId || '').trim(),
      verdict: rawDecision?.verdict,
      relation: rawDecision?.relation,
      evidenceQuote: String(rawDecision?.evidenceQuote || '').trim(),
    };
    const duplicate = seen.has(decision.noteId);
    seen.add(decision.noteId);
    const candidate = candidateById.get(decision.noteId);
    if (duplicate) return { ...decision, accepted: false, reason: 'Duplicate candidate decision.' };
    if (!candidate) return { ...decision, accepted: false, reason: 'The note is not in this query-bound candidate set.' };
    if (!allowedRelations.includes(decision.relation)) {
      return { ...decision, accepted: false, reason: 'The reviewed relation was not requested by the query.' };
    }
    if (decision.verdict !== 'supports') {
      return { ...decision, accepted: false, reason: decision.verdict === 'rejects'
        ? 'The host AI rejected this candidate.'
        : 'The host AI marked this candidate uncertain.' };
    }
    if (!quoteAppearsInCandidate(decision.evidenceQuote, candidate.excerpts)) {
      return { ...decision, accepted: false, reason: 'The quote is not present in the bounded candidate excerpts.' };
    }
    const note = noteById.get(decision.noteId) as NoteRow | undefined;
    const star = note ? starById.get(note.star_id) : undefined;
    if (!note || !star) return { ...decision, accepted: false, reason: 'The authenticated note or star no longer exists.' };
    const reviewed = buildHostReviewedEvidencePassage({
      note,
      star,
      relation: decision.relation,
      evidenceQuote: decision.evidenceQuote,
      matchedTerms: [...queryPlan.targetTerms, ...queryPlan.actionTerms],
    });
    if (!reviewed.accepted || !reviewed.passage) {
      return { ...decision, accepted: false, reason: reviewed.reason };
    }
    acceptedPassages.push(reviewed.passage);
    return { ...decision, accepted: true, reason: reviewed.reason };
  });

  const resolution = acceptedPassages.length
    ? resolutionFromReviewedPassages(baseResolution, acceptedPassages, starById)
    : baseResolution;
  const invalid = results.some(result => result.verdict === 'supports' && !result.accepted);
  return {
    resolution,
    state: {
      required: false,
      phase: invalid && !acceptedPassages.length ? 'review-invalid' : 'review-complete',
      usesExternalModelService: false,
      candidateNoteIds: candidateReview.candidateNoteIds,
      allowedRelations,
      decisions: results,
      instruction: acceptedPassages.length
        ? resolution.instruction
        : 'No reviewed candidate passed the server checks. State that no supporting memory was found; do not substitute another location.',
    } satisfies MemorySemanticReviewState,
  };
};
