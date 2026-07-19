import {
  getMcpToolDefinition,
  MCP_TOOL_MANIFEST,
} from './mcp-tool-manifest.mjs';

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const copyJsonValue = value => {
  if (Array.isArray(value)) return value.map(copyJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyJsonValue(entry)]));
};

const displayPath = path => path || 'arguments';

const valueKey = value => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array:${JSON.stringify(value)}`;
  if (isRecord(value)) {
    const ordered = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    return `object:${JSON.stringify(ordered)}`;
  }
  return `${typeof value}:${String(value)}`;
};

const typeMessage = (path, type) => `${displayPath(path)} must be ${type === 'integer' ? 'an integer' : `a ${type}`}.`;

const validateSchema = (schema, value, path) => {
  if (!schema || typeof schema !== 'object') {
    return { ok: false, message: `${displayPath(path)} has an unsupported schema.` };
  }

  if (value === undefined && Object.prototype.hasOwnProperty.call(schema, 'default')) {
    value = copyJsonValue(schema.default);
  }

  if (value === undefined) return { ok: true, value };

  if (Array.isArray(schema.enum) && !schema.enum.some(entry => Object.is(entry, value))) {
    return { ok: false, message: `${displayPath(path)} must be one of: ${schema.enum.join(', ')}.` };
  }

  if (schema.type === 'object') {
    if (!isRecord(value)) return { ok: false, message: typeMessage(path, 'object') };
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const output = {};

    if (schema.additionalProperties === false) {
      const unknown = Object.keys(value).find(key => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unknown) return { ok: false, message: `${displayPath(path)} contains an unknown field: ${unknown}.` };
    }

    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
        return { ok: false, message: `${displayPath(path)}.${key} is required.` };
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      const result = validateSchema(propertySchema, value[key], `${displayPath(path)}.${key}`);
      if (!result.ok) return result;
      if (result.value !== undefined) output[key] = result.value;
    }

    if (schema.additionalProperties !== false) {
      for (const [key, entry] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) output[key] = copyJsonValue(entry);
      }
    }
    return { ok: true, value: output };
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return { ok: false, message: typeMessage(path, 'array') };
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      return { ok: false, message: `${displayPath(path)} must contain at least ${schema.minItems} item(s).` };
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      return { ok: false, message: `${displayPath(path)} must contain at most ${schema.maxItems} item(s).` };
    }
    if (schema.uniqueItems === true && new Set(value.map(valueKey)).size !== value.length) {
      return { ok: false, message: `${displayPath(path)} must contain unique items.` };
    }
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const result = validateSchema(schema.items || {}, value[index], `${displayPath(path)}[${index}]`);
      if (!result.ok) return result;
      output.push(result.value);
    }
    return { ok: true, value: output };
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') return { ok: false, message: typeMessage(path, 'string') };
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      return { ok: false, message: `${displayPath(path)} must contain at least ${schema.minLength} character(s).` };
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      return { ok: false, message: `${displayPath(path)} must contain at most ${schema.maxLength} character(s).` };
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      return { ok: false, message: `${displayPath(path)} has an invalid format.` };
    }
    return { ok: true, value };
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, message: typeMessage(path, schema.type) };
    }
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      return { ok: false, message: typeMessage(path, 'integer') };
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      return { ok: false, message: `${displayPath(path)} must be at least ${schema.minimum}.` };
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      return { ok: false, message: `${displayPath(path)} must be at most ${schema.maximum}.` };
    }
    return { ok: true, value };
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') return { ok: false, message: typeMessage(path, 'boolean') };
    return { ok: true, value };
  }

  return { ok: false, message: `${displayPath(path)} has an unsupported schema type.` };
};

const validators = new Map(MCP_TOOL_MANIFEST.map(definition => [
  definition.name,
  value => validateSchema(definition.inputSchema, value, 'arguments'),
]));

export const validateMcpToolArguments = (name, value) => {
  const validator = validators.get(name);
  if (!validator) {
    return { ok: false, message: `Unknown or disabled tool: ${name}` };
  }
  return validator(value);
};

export const assertValidMcpToolArguments = (name, value) => {
  getMcpToolDefinition(name);
  const result = validateMcpToolArguments(name, value);
  if (!result.ok) throw new Error(result.message);
  return result.value;
};
