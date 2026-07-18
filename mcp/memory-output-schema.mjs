import * as z from 'zod/v4';
import { MEMORY_RESEARCH_OUTPUT_SCHEMA } from '../supabase/functions/_shared/mcp-memory-public-schema.mjs';

const publicStateDefinitions = MEMORY_RESEARCH_OUTPUT_SCHEMA.oneOf;
const exactPublicStateSchema = z.union(
  publicStateDefinitions.map(definition => z.fromJSONSchema(definition)),
);

const uniquePropertySchemas = key => {
  const definitions = new Map();
  publicStateDefinitions.forEach(state => {
    const definition = state.properties?.[key];
    if (definition) definitions.set(JSON.stringify(definition), definition);
  });
  return [...definitions.values()].map(definition => z.fromJSONSchema(definition));
};

const objectShape = {};
const propertyNames = new Set(
  publicStateDefinitions.flatMap(state => Object.keys(state.properties || {})),
);

propertyNames.forEach(key => {
  const variants = uniquePropertySchemas(key);
  const requiredInEveryState = publicStateDefinitions.every(state => state.required?.includes(key));
  let propertySchema = variants.length === 1 ? variants[0] : z.union(variants);
  if (!requiredInEveryState) propertySchema = propertySchema.optional();
  objectShape[key] = propertySchema;
});

// The MCP SDK currently publishes only top-level Zod object schemas. Keep an
// object shell for SDK compatibility, then enforce the exact four-state union.
export const memoryResearchOutputSchema = z.object(objectShape).strict().superRefine((value, context) => {
  const result = exactPublicStateSchema.safeParse(value);
  if (result.success) return;
  context.addIssue({
    code: 'custom',
    message: 'Memory research output must match one strict public response state.',
  });
});
