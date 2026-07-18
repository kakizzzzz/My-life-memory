const temporalContextSchema = {
  type: 'object',
  properties: {
    timeZone: { type: 'string' },
    currentUtcDateTime: { type: 'string' },
    currentLocalDate: { type: 'string' },
    currentLocalDateTime: { type: 'string' },
    currentDateRole: { const: 'query-evaluation-only' },
  },
  required: [
    'timeZone',
    'currentUtcDateTime',
    'currentLocalDate',
    'currentLocalDateTime',
    'currentDateRole',
  ],
  additionalProperties: false,
};

const directiveSchema = (action, exactTextType, mayAddExplanation) => ({
  type: 'object',
  properties: {
    action: { const: action },
    exactText: exactTextType === 'null' ? { type: 'null' } : { type: 'string' },
    mayAddExplanation: { const: mayAddExplanation },
  },
  required: ['action', 'exactText', 'mayAddExplanation'],
  additionalProperties: false,
});

const coordinatesSchema = {
  type: 'object',
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
  },
  required: ['lat', 'lng'],
  additionalProperties: false,
};

const evidencePassageSchema = {
  type: 'object',
  properties: {
    noteId: { type: 'string' },
    starId: { type: 'string' },
    role: { enum: ['anchor', 'target', 'corroboration'] },
    source: { enum: ['title', 'body'] },
    evidenceSource: { enum: ['stored-explicit', 'user-confirmed-reference'] },
    excerpt: { type: 'string', maxLength: 240 },
    relation: { enum: ['home', 'work', 'study', 'observation', 'activity'] },
    createdAt: { type: ['number', 'null'] },
    coordinates: coordinatesSchema,
  },
  required: [
    'noteId',
    'starId',
    'role',
    'source',
    'evidenceSource',
    'excerpt',
    'relation',
    'createdAt',
  ],
  additionalProperties: false,
};

const evidenceRecordSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    starId: { type: 'string' },
    title: { type: 'string' },
    excerpt: { type: 'string', maxLength: 240 },
    createdAt: { type: ['number', 'null'] },
    hasImages: { type: 'boolean' },
    coordinates: coordinatesSchema,
  },
  required: ['id', 'starId', 'title', 'excerpt', 'createdAt', 'hasImages', 'coordinates'],
  additionalProperties: false,
};

const evidenceLocationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    index: { type: 'integer', minimum: 0 },
    coordinates: coordinatesSchema,
    noteCount: { type: 'integer', minimum: 0 },
  },
  required: ['id', 'index', 'coordinates', 'noteCount'],
  additionalProperties: false,
};

const evidenceRouteSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    durationSeconds: { type: 'number', minimum: 0 },
    distance: { type: 'number', minimum: 0 },
    createdAt: { type: ['number', 'null'] },
    segmentCount: { type: 'integer', minimum: 0 },
    pointCount: { type: 'integer', minimum: 0 },
  },
  required: ['id', 'durationSeconds', 'distance', 'createdAt', 'segmentCount', 'pointCount'],
  additionalProperties: false,
};

const commonProperties = {
  ok: { const: true },
  source: { const: 'my-life-memory-normalized-v2' },
  action: { const: 'research_memory_context' },
  query: { type: 'string' },
  timestamp: { type: 'string' },
  temporalContext: temporalContextSchema,
  schemaVersion: { const: '2' },
};

const commonRequired = [
  'ok',
  'source',
  'action',
  'query',
  'timestamp',
  'temporalContext',
  'schemaVersion',
  'status',
  'directive',
  'evidence',
];

const supported = {
  type: 'object',
  properties: {
    ...commonProperties,
    status: { const: 'supported' },
    directive: directiveSchema('ANSWER_FROM_EVIDENCE', 'null', true),
    evidence: {
      type: 'object',
      properties: {
        passages: { type: 'array', maxItems: 12, items: evidencePassageSchema },
        records: { type: 'array', maxItems: 100, items: evidenceRecordSchema },
        locations: { type: 'array', maxItems: 100, items: evidenceLocationSchema },
        routes: { type: 'array', maxItems: 20, items: evidenceRouteSchema },
        verifiedPlaceNames: { type: 'array', maxItems: 10, items: { type: 'string' } },
        selectedImageNoteIds: { type: 'array', maxItems: 10, items: { type: 'string' } },
      },
      required: ['passages', 'records', 'locations', 'routes', 'verifiedPlaceNames', 'selectedImageNoteIds'],
      additionalProperties: false,
    },
    confidenceKind: { const: 'heuristic' },
    confidenceBand: { enum: ['high', 'medium', 'low', 'none'] },
    reasonCodes: { type: 'array', items: { type: 'string' } },
    classification: {
      type: 'object',
      properties: {
        label: { enum: ['travel', 'daily', 'mixed', 'uncertain'] },
        confidenceKind: { const: 'heuristic' },
        confidenceBand: { enum: ['high', 'medium', 'low', 'none'] },
      },
      required: ['label', 'confidenceKind', 'confidenceBand'],
      additionalProperties: false,
    },
  },
  required: [...commonRequired, 'confidenceKind', 'confidenceBand', 'reasonCodes'],
  additionalProperties: false,
};

const clarificationOptionSchema = {
  type: 'object',
  properties: {
    optionId: { type: 'string' },
    label: { type: 'string' },
  },
  required: ['optionId', 'label'],
  additionalProperties: false,
};

const requestedFacetSchema = {
  enum: ['time', 'place', 'title-word', 'object-name', 'activity'],
};

const ambiguous = {
  type: 'object',
  properties: {
    ...commonProperties,
    status: { const: 'ambiguous' },
    directive: directiveSchema('ASK_USER_EXACT', 'string', false),
    clarification: {
      type: 'object',
      properties: {
        exactText: { type: 'string' },
        kind: { enum: ['yes-no', 'choose-option', 'request-facet'] },
        options: { type: 'array', maxItems: 4, items: clarificationOptionSchema },
        continuationToken: { type: ['string', 'null'] },
        requestedFacets: { type: 'array', items: requestedFacetSchema },
      },
      required: ['exactText', 'kind', 'options', 'continuationToken', 'requestedFacets'],
      additionalProperties: false,
    },
    evidence: { type: 'null' },
  },
  required: [...commonRequired, 'clarification'],
  additionalProperties: false,
};

const notFound = {
  type: 'object',
  properties: {
    ...commonProperties,
    status: { const: 'not-found' },
    directive: directiveSchema('STATE_NO_EVIDENCE_EXACT', 'string', false),
    clarification: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            requestedFacets: { type: 'array', items: requestedFacetSchema },
          },
          required: ['requestedFacets'],
          additionalProperties: false,
        },
      ],
    },
    evidence: { type: 'null' },
  },
  required: [...commonRequired, 'clarification'],
  additionalProperties: false,
};

const candidateReview = {
  type: 'object',
  properties: {
    ...commonProperties,
    status: { const: 'candidate-review' },
    directive: directiveSchema('CALL_TOOL_AGAIN', 'string', false),
    continuationToken: { type: ['string', 'null'] },
    evidence: { type: 'null' },
  },
  required: [...commonRequired, 'continuationToken'],
  additionalProperties: false,
};

/** @type {import('zod/v4/core').JSONSchema} */
export const MEMORY_RESEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  oneOf: [supported, ambiguous, notFound, candidateReview],
};
