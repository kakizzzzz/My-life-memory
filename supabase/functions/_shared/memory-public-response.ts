type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord => (
  value && typeof value === 'object' ? value as UnknownRecord : {}
);

export const withoutMemoryCoordinates = (value: unknown): UnknownRecord => {
  const { coordinates: _coordinates, lat: _lat, lng: _lng, ...rest } = asRecord(value);
  return rest;
};

const redactPassages = (value: unknown) => (
  Array.isArray(value) ? value.map(withoutMemoryCoordinates) : []
);

/**
 * Keeps ambiguity evidence readable while preventing weak clients from turning
 * unresolved candidates into a coordinate or route answer.
 */
export const applyMemoryResearchDisclosureBoundary = <T extends UnknownRecord>(research: T): T => {
  const boundary = asRecord(research.answerBoundary);
  const semanticReview = asRecord(research.semanticReview);
  const candidateReview = asRecord(research.candidateReview);
  const candidatesExposed = semanticReview.candidatesExposed === true;
  const hasHiddenCandidatePayload = !candidatesExposed && (
    (Array.isArray(candidateReview.titleNoteIds) && candidateReview.titleNoteIds.length > 0)
    || (Array.isArray(candidateReview.candidateNoteIds) && candidateReview.candidateNoteIds.length > 0)
    || (Array.isArray(candidateReview.candidateExcerpts) && candidateReview.candidateExcerpts.length > 0)
    || (Array.isArray(research.titleNoteIds) && research.titleNoteIds.length > 0)
    || (Array.isArray(research.candidateNoteIds) && research.candidateNoteIds.length > 0)
  );
  const candidateSafeResearch = hasHiddenCandidatePayload ? {
    ...research,
    candidateReview: {
      ...candidateReview,
      titleNoteIds: [],
      candidateNoteIds: [],
      candidateExcerpts: [],
    },
    titleNoteIds: [],
    candidateNoteIds: [],
  } as T : research;
  if (boundary.mayStateCoordinates !== false) return candidateSafeResearch;

  const personalContext = asRecord(candidateSafeResearch.personalContext);
  return {
    ...candidateSafeResearch,
    personalContext: {
      ...personalContext,
      anchors: Array.isArray(personalContext.anchors)
        ? personalContext.anchors.map(withoutMemoryCoordinates)
        : [],
      evidencePassages: redactPassages(personalContext.evidencePassages),
    },
    evidencePassages: redactPassages(candidateSafeResearch.evidencePassages),
    clusters: [],
    latestRecordedMemory: null,
    selectedImageNoteIds: [],
    selectedStarIds: [],
    selectedTrackIds: [],
  } as T;
};
