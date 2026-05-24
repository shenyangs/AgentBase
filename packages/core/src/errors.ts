export class AgentBaseError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AgentBaseError";
    this.code = code;
    this.details = details;
  }
}

export class PolicyError extends AgentBaseError {
  constructor(message: string, details?: unknown) {
    super("POLICY_ERROR", message, details);
    this.name = "PolicyError";
  }
}

export class ToolValidationError extends AgentBaseError {
  constructor(message: string, details?: unknown) {
    super("TOOL_VALIDATION_ERROR", message, details);
    this.name = "ToolValidationError";
  }
}

export function errorToObject(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof AgentBaseError) {
    return { code: error.code, message: error.message, details: error.details };
  }

  if (error instanceof Error) {
    return { code: error.name || "ERROR", message: error.message };
  }

  return { code: "ERROR", message: String(error) };
}
