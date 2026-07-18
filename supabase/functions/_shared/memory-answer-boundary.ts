import type { MemoryQueryPlan } from './memory-query-plan.ts';
import type { PersonalContextResolution } from './memory-personal-context.ts';

export type MemoryAnswerBoundary = {
  mandatory: true;
  status: 'supported' | 'ambiguous' | 'not-found' | 'needs-time-range' | 'needs-place-resolution' | 'needs-candidate-review';
  answerMode: 'evidence-only' | 'ask-for-disambiguation' | 'state-no-answer' | 'retry-with-bounds';
  evidenceOnly: true;
  exactPersonalAnchorQuestion: boolean;
  candidateNotesAreEvidence: false;
  mayUseCandidateNotesAsAnswer: false;
  mustUseSuggestedReply: boolean;
  mayStateCoordinates: boolean;
  coordinatePolicy: 'evidence-only' | 'forbidden';
  placeNamePolicy: 'explicit-evidence-only';
  verifiedPlaceNames: string[];
  allowedEvidenceNoteIds: string[];
  requiredAction: 'answer-from-evidence' | 'ask-for-disambiguation' | 'state-no-answer' | 'retry-with-bounds';
  suggestedReply: string;
  forbiddenInferences: string[];
};

const queryLanguage = (query: string) => {
  if (/\p{Script=Hangul}/u.test(query)) return 'ko';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query)) return 'ja';
  if (/\p{Script=Han}/u.test(query)) return 'zh';
  return 'en';
};

const relationName = (plan: MemoryQueryPlan) => {
  const relation = plan.anchorRelations[0] || 'home';
  const names = {
    zh: { home: '家', work: '工作地点', study: '学习地点' },
    en: { home: 'home', work: 'workplace', study: 'place of study' },
    ja: { home: '自宅', work: '職場', study: '学習場所' },
    ko: { home: '집', work: '직장', study: '학습 장소' },
  } as const;
  return names[queryLanguage(plan.originalQuery)][relation];
};

const noAnswerReply = (plan: MemoryQueryPlan) => {
  const relation = relationName(plan);
  switch (queryLanguage(plan.originalQuery)) {
    case 'zh': return `已保存的笔记中没有足够的第一人称证据确定“${relation}”的位置。`;
    case 'ja': return `保存されたノートには「${relation}」の場所を特定できる十分な一人称の証拠がありません。`;
    case 'ko': return `저장된 노트에는 ${relation} 위치를 확인할 충분한 1인칭 근거가 없습니다.`;
    default: return `The saved notes do not contain enough first-person evidence to identify the user's ${relation}.`;
  }
};

const ambiguousReply = (plan: MemoryQueryPlan) => {
  const relation = relationName(plan);
  switch (queryLanguage(plan.originalQuery)) {
    case 'zh': return `已保存的笔记中存在多个有证据支持的“${relation}”位置，请补充时间范围后再查询。`;
    case 'ja': return `保存されたノートには証拠のある「${relation}」が複数あります。期間を指定してください。`;
    case 'ko': return `저장된 노트에 근거가 있는 ${relation} 위치가 여러 개 있습니다. 기간을 지정해 주세요.`;
    default: return `Several evidence-backed ${relation} locations exist. Ask the user for a time range before choosing one.`;
  }
};

const supportedAnchorReply = (plan: MemoryQueryPlan) => {
  const relation = relationName(plan);
  switch (queryLanguage(plan.originalQuery)) {
    case 'zh': return `笔记中的第一人称证据指向返回的“${relation}”星标和坐标；现有证据未提供可验证的地点名称时，不要补充城市、街区、建筑或地址。`;
    case 'ja': return `一人称のノート証拠は返された「${relation}」の星と座標を示します。証拠に地名がない場合、都市、地区、建物、住所を補わないでください。`;
    case 'ko': return `1인칭 노트 근거는 반환된 ${relation} 별과 좌표를 가리킵니다. 근거에 지명이 없으면 도시, 동네, 건물, 주소를 덧붙이지 마세요.`;
    default: return `First-person note evidence identifies the returned ${relation} star and coordinates. Do not add a city, neighbourhood, building, or address unless that name appears in verified evidence.`;
  }
};

export const isExactPersonalAnchorQuestion = (plan: MemoryQueryPlan) => (
  plan.anchorRelations.length > 0
  && plan.spatialRelation === 'exact'
  && plan.answerIntent === 'locate'
  && plan.eventRelations.length === 0
  && plan.targetTerms.length === 0
  && !plan.routeIntent
);

export const buildMemoryAnswerBoundary = ({
  queryPlan,
  personalContext,
  temporalResolutionRequired,
  unresolvedPublicPlace,
  semanticReviewRequired = false,
  hasMatchingRecords,
  verifiedPlaceNames = [],
  evidenceNoteIds = [],
}: {
  queryPlan: MemoryQueryPlan;
  personalContext: PersonalContextResolution;
  temporalResolutionRequired: boolean;
  unresolvedPublicPlace: boolean;
  semanticReviewRequired?: boolean;
  hasMatchingRecords: boolean;
  verifiedPlaceNames?: string[];
  evidenceNoteIds?: string[];
}): MemoryAnswerBoundary => {
  const exactPersonalAnchorQuestion = isExactPersonalAnchorQuestion(queryPlan);
  const forbiddenInferences = [
    'Do not reverse-geocode coordinates or add a city, neighbourhood, building, landmark, or address from model knowledge.',
    'Do not roleplay, continue a fictional premise, or turn an unverified candidate into a fact.',
    'Do not use candidateNotes, titleIndex, the latest memory, or unrelated records as evidence.',
  ];

  if (temporalResolutionRequired || unresolvedPublicPlace) return {
    mandatory: true,
    status: temporalResolutionRequired ? 'needs-time-range' : 'needs-place-resolution',
    answerMode: 'retry-with-bounds',
    evidenceOnly: true,
    exactPersonalAnchorQuestion,
    candidateNotesAreEvidence: false,
    mayUseCandidateNotesAsAnswer: false,
    mustUseSuggestedReply: true,
    mayStateCoordinates: false,
    coordinatePolicy: 'forbidden',
    placeNamePolicy: 'explicit-evidence-only',
    verifiedPlaceNames,
    allowedEvidenceNoteIds: [],
    requiredAction: 'retry-with-bounds',
    suggestedReply: 'Resolve the requested time or explicit public place first. Do not answer from the unbounded archive.',
    forbiddenInferences,
  };

  if (semanticReviewRequired) return {
    mandatory: true,
    status: 'needs-candidate-review',
    answerMode: 'retry-with-bounds',
    evidenceOnly: true,
    exactPersonalAnchorQuestion,
    candidateNotesAreEvidence: false,
    mayUseCandidateNotesAsAnswer: false,
    mustUseSuggestedReply: true,
    mayStateCoordinates: false,
    coordinatePolicy: 'forbidden',
    placeNamePolicy: 'explicit-evidence-only',
    verifiedPlaceNames: [],
    allowedEvidenceNoteIds: [],
    requiredAction: 'retry-with-bounds',
    suggestedReply: 'Do not answer yet. Review only the bounded candidateNotes, then call research_memory_context again with the same query and exact-quote semanticReview decisions. If the client cannot perform this review, state that the archive does not contain enough verified evidence.',
    forbiddenInferences,
  };

  if (personalContext.status === 'ambiguous') return {
    mandatory: true,
    status: 'ambiguous',
    answerMode: 'ask-for-disambiguation',
    evidenceOnly: true,
    exactPersonalAnchorQuestion,
    candidateNotesAreEvidence: false,
    mayUseCandidateNotesAsAnswer: false,
    mustUseSuggestedReply: true,
    mayStateCoordinates: false,
    coordinatePolicy: 'forbidden',
    placeNamePolicy: 'explicit-evidence-only',
    verifiedPlaceNames: [],
    allowedEvidenceNoteIds: [...new Set(evidenceNoteIds)],
    requiredAction: 'ask-for-disambiguation',
    suggestedReply: exactPersonalAnchorQuestion
      ? ambiguousReply(queryPlan)
      : 'Several evidence-backed personal anchors remain possible. Ask for a date or other disambiguating detail.',
    forbiddenInferences,
  };

  if (personalContext.status === 'not-found' || !hasMatchingRecords) return {
    mandatory: true,
    status: 'not-found',
    answerMode: 'state-no-answer',
    evidenceOnly: true,
    exactPersonalAnchorQuestion,
    candidateNotesAreEvidence: false,
    mayUseCandidateNotesAsAnswer: false,
    mustUseSuggestedReply: true,
    mayStateCoordinates: false,
    coordinatePolicy: 'forbidden',
    placeNamePolicy: 'explicit-evidence-only',
    verifiedPlaceNames: [],
    allowedEvidenceNoteIds: [],
    requiredAction: 'state-no-answer',
    suggestedReply: exactPersonalAnchorQuestion
      ? noAnswerReply(queryPlan)
      : 'No saved evidence answers this question. State that no supporting memory was found.',
    forbiddenInferences,
  };

  return {
    mandatory: true,
    status: 'supported',
    answerMode: 'evidence-only',
    evidenceOnly: true,
    exactPersonalAnchorQuestion,
    candidateNotesAreEvidence: false,
    mayUseCandidateNotesAsAnswer: false,
    mustUseSuggestedReply: false,
    mayStateCoordinates: true,
    coordinatePolicy: 'evidence-only',
    placeNamePolicy: 'explicit-evidence-only',
    verifiedPlaceNames,
    allowedEvidenceNoteIds: [...new Set(evidenceNoteIds)],
    requiredAction: 'answer-from-evidence',
    suggestedReply: exactPersonalAnchorQuestion
      ? supportedAnchorReply(queryPlan)
      : 'Answer only from evidencePassages and records selected for this question.',
    forbiddenInferences,
  };
};
