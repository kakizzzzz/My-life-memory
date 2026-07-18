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
  if (boundary.mayStateCoordinates !== false) return research;

  const personalContext = asRecord(research.personalContext);
  return {
    ...research,
    personalContext: {
      ...personalContext,
      anchors: Array.isArray(personalContext.anchors)
        ? personalContext.anchors.map(withoutMemoryCoordinates)
        : [],
      evidencePassages: redactPassages(personalContext.evidencePassages),
    },
    evidencePassages: redactPassages(research.evidencePassages),
    clusters: [],
    latestRecordedMemory: null,
    selectedImageNoteIds: [],
    selectedStarIds: [],
    selectedTrackIds: [],
  } as T;
};
