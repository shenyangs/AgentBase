import type { JsonSchema } from "./types";
import { ToolValidationError } from "./errors";

export function validateJsonSchema(value: unknown, schema: JsonSchema, path = "input"): void {
  if (!schema.type) {
    return;
  }

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new ToolValidationError(`${path} must be one of ${schema.enum.join(", ")}`);
  }

  if (schema.type === "object") {
    if (!isRecord(value)) {
      throw new ToolValidationError(`${path} must be an object`);
    }

    for (const requiredKey of schema.required ?? []) {
      if (!(requiredKey in value)) {
        throw new ToolValidationError(`${path}.${requiredKey} is required`);
      }
    }

    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) {
        validateJsonSchema(value[key], childSchema, `${path}.${key}`);
      }
    }

    return;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new ToolValidationError(`${path} must be an array`);
    }

    if (schema.items) {
      value.forEach((item, index) => validateJsonSchema(item, schema.items!, `${path}[${index}]`));
    }

    return;
  }

  if (schema.type === "integer") {
    if (!Number.isInteger(value)) {
      throw new ToolValidationError(`${path} must be an integer`);
    }
    return;
  }

  if (schema.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new ToolValidationError(`${path} must be a number`);
    }
    return;
  }

  if (schema.type === "null") {
    if (value !== null) {
      throw new ToolValidationError(`${path} must be null`);
    }
    return;
  }

  if (typeof value !== schema.type) {
    throw new ToolValidationError(`${path} must be a ${schema.type}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
