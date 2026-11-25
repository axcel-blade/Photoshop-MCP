export type ErrorCode =
  | "VALIDATION_ERROR"
  | "PHOTOSHOP_NOT_INSTALLED"
  | "PHOTOSHOP_NOT_RUNNING"
  | "PHOTOSHOP_SCRIPT_ERROR"
  | "PHOTOSHOP_ERROR"
  | "BRIDGE_TIMEOUT"
  | "BRIDGE_UNAVAILABLE"
  | "CANCELLED"
  | "NO_ACTIVE_DOCUMENT"
  | "LAYER_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "OBJECT_NOT_FOUND"
  | "PATH_NOT_ALLOWED"
  | "FILE_EXISTS"
  | "FILE_NOT_FOUND"
  | "CONFIRMATION_REQUIRED"
  | "UNSUPPORTED_OPERATION"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "LIMIT_EXCEEDED"
  | "PLAN_INVALID"
  | "WORKFLOW_FAILED"
  | "INTERNAL_ERROR";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Structured error used across server, bridge, design engine and workflow engine. */
export class McpDesignError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "McpDesignError";
  }

  toJSON(): ErrorPayload {
    return { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}

export function toMcpError(err: unknown): McpDesignError {
  if (err instanceof McpDesignError) return err;
  if (err instanceof Error) return new McpDesignError("INTERNAL_ERROR", err.message);
  return new McpDesignError("INTERNAL_ERROR", String(err));
}

/** Aliases used by the Photoshop tool modules. */
export { McpDesignError as PsMcpError, toMcpError as toPsError };

/** Capability record for features that cannot be driven programmatically. */
export interface CapabilityStatus {
  feature: string;
  status: "supported" | "partial" | "unsupported" | "requires_provider";
  reason: string;
  alternative?: string;
}

export function unsupported(feature: string, reason: string, alternative?: string): McpDesignError {
  const cap: CapabilityStatus = { feature, status: "unsupported", reason, alternative };
  return new McpDesignError("UNSUPPORTED_OPERATION", `${feature} is not available programmatically: ${reason}`, cap);
}
