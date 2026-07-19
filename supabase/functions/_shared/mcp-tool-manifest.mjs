import {
  RESEARCH_MEMORY_TOOL_DESCRIPTION,
  SEARCH_MEMORY_TOOL_DESCRIPTION,
} from './mcp-memory-contract.mjs';
import { MEMORY_RESEARCH_OUTPUT_SCHEMA } from './mcp-memory-public-schema.mjs';

const optionalDateSchema = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
};

const semanticHintsSchema = {
  type: 'object',
  description: 'Optional query-only vocabulary hints supplied by the host model. They may rank neutral reference candidates but can never become memory evidence.',
  properties: {
    concepts: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          surface: { type: 'string', minLength: 1, maxLength: 48 },
          broadTerms: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 48 },
          },
        },
        required: ['surface', 'broadTerms'],
        additionalProperties: false,
      },
    },
  },
  required: ['concepts'],
  additionalProperties: false,
};

const referenceConfirmationSchema = {
  type: 'object',
  description: 'Explicit user confirmation or rejection of a privacy-screened option returned by an earlier ambiguous response.',
  properties: {
    continuationToken: { type: 'string', minLength: 1, maxLength: 16384 },
    selectedOptionId: { type: 'string', minLength: 1, maxLength: 80 },
    answer: { type: 'string', enum: ['confirm', 'reject', 'none'] },
  },
  required: ['continuationToken', 'answer'],
  additionalProperties: false,
};

const readOnlyAnnotations = openWorldHint => ({
  readOnlyHint: true,
  openWorldHint,
});

export const MCP_TOOL_MANIFEST = [
  {
    name: 'research_memory_context',
    title: 'Research Memory Context',
    description: RESEARCH_MEMORY_TOOL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        place: {
          type: 'string',
          maxLength: 160,
          description: 'Only an explicit public place name to resolve, such as Example City, Example Town, or Example Village. Never put a private alias or the full question here.',
        },
        region: {
          type: 'string',
          maxLength: 160,
          description: 'Optional country or broader public region used to disambiguate the place.',
        },
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
        centerLat: { type: 'number', minimum: -90, maximum: 90 },
        centerLng: { type: 'number', minimum: -180, maximum: 180 },
        radiusKm: { type: 'number', minimum: 0.1, maximum: 1000 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
        semanticHints: semanticHintsSchema,
        referenceConfirmation: referenceConfirmationSchema,
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: MEMORY_RESEARCH_OUTPUT_SCHEMA,
    annotations: readOnlyAnnotations(true),
  },
  {
    name: 'get_memory_images',
    title: 'Read Relevant Memory Photos',
    description: 'Return private image blocks for up to 10 authenticated-user note ids selected as evidence by a supported memory result. Call only when visual analysis is useful. Vision-capable clients may analyze returned image blocks; otherwise use metadata and never claim to have seen the photos.',
    inputSchema: {
      type: 'object',
      properties: {
        noteIds: {
          type: 'array',
          items: { type: 'string', minLength: 1, maxLength: 200 },
          minItems: 1,
          maxItems: 10,
          uniqueItems: true,
        },
        maxImages: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
      },
      required: ['noteIds'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
  {
    name: 'search_memories',
    title: 'Search My Life Memory',
    description: SEARCH_MEMORY_TOOL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', default: '' },
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
  {
    name: 'list_locations',
    title: 'List Memory Locations',
    description: 'List saved stars for the authenticated user. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
  {
    name: 'get_location_memory',
    title: 'Get Location Memory',
    description: 'Read notes and image metadata for one authenticated-user star/location. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {
        starId: { type: 'string', minLength: 1 },
      },
      required: ['starId'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
  {
    name: 'get_day_memory',
    title: 'Get Day Memory',
    description: 'Read memories for one local date. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {
        date: optionalDateSchema,
      },
      required: ['date'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
  {
    name: 'get_routes',
    title: 'Get Routes',
    description: 'Read saved GPS routes. Paths are omitted unless includePaths is true. Answer only from returned data. If count is 0, do not infer or invent.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
        includePaths: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
  {
    name: 'summarize_memory_range',
    title: 'Summarize Memory Range',
    description: 'Return counts and top locations for a date range. The AI client may summarize only this returned data and must not invent missing records.',
    inputSchema: {
      type: 'object',
      properties: {
        dateFrom: optionalDateSchema,
        dateTo: optionalDateSchema,
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
  {
    name: 'export_memory_report',
    title: 'Export Memory Report',
    description: 'Generate a readable HTML report string for the authenticated user using only stored My Life Memory data.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: readOnlyAnnotations(false),
  },
];

export const MCP_TOOL_NAMES = MCP_TOOL_MANIFEST.map(tool => tool.name);

export const getMcpToolDefinition = name => {
  const tool = MCP_TOOL_MANIFEST.find(entry => entry.name === name);
  if (!tool) throw new Error(`Unknown MCP tool definition: ${name}`);
  return tool;
};
