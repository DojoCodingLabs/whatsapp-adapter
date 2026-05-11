/**
 * Map SDK typed errors to MCP tool-call responses. The spec
 * contract: model-recoverable errors return `isError: true`
 * with a recovery hint; protocol / programmer errors throw.
 *
 * Each `WhatsAppError` subclass gets a hint that tells the LLM
 * what to try next — `WindowClosedError` → "use a template",
 * `TemplateError` → "inspect via whatsapp_get_template", etc.
 * AuthenticationError's hint never echoes the token (spec
 * scenario "AuthenticationError hint does not leak the token").
 */

import {
  AuthenticationError,
  CapabilityError,
  MissingCredentialsError,
  PermissionError,
  RateLimitError,
  TemplateError,
  WhatsAppError,
  WindowClosedError,
} from "@dojocoding/whatsapp-sdk";

export interface ToolErrorResponse {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
  structuredContent: {
    error: {
      code: WhatsAppError["code"];
      message: string;
    };
  };
  [key: string]: unknown;
}

function recoveryHint(error: WhatsAppError): string {
  if (error instanceof WindowClosedError) {
    return "The 24-hour customer-service window is closed for this recipient. Use `whatsapp_send_template` with an approved template to re-engage; templates are window-exempt.";
  }
  if (error instanceof TemplateError) {
    return `Template send failed: ${error.message}. Inspect the template with \`whatsapp_get_template\` to verify the variable count, language code, and approval status, then retry.`;
  }
  if (error instanceof RateLimitError) {
    const retry = error.retryAfterMs;
    return retry !== undefined
      ? `Meta rate-limited this send (retryAfterMs=${retry}). Wait at least ${retry} ms before retrying, or reduce send concurrency.`
      : "Meta rate-limited this send. Wait before retrying, or reduce send concurrency.";
  }
  if (error instanceof AuthenticationError) {
    // SPEC: SHALL NOT contain the value of WHATSAPP_ACCESS_TOKEN.
    return "The access token was rejected by Meta. The server administrator should verify the value of `WHATSAPP_ACCESS_TOKEN`; do not echo or log the token contents.";
  }
  if (error instanceof PermissionError) {
    return "The access token lacks the required scope. The token must include `whatsapp_business_messaging` (and `whatsapp_business_management` for template-registry reads).";
  }
  if (error instanceof CapabilityError) {
    return `This WABA or phone number is not capability-enabled for the requested operation: ${error.message}.`;
  }
  if (error instanceof MissingCredentialsError) {
    return "The MCP server was started without complete credentials. The operator should restart with `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` set.";
  }
  return `WhatsApp send failed: ${error.message}.`;
}

/**
 * Convert a caught `WhatsAppError` into the MCP tool-error
 * response shape. Non-WhatsApp errors are re-thrown by the
 * caller; see `withErrorMapping`.
 *
 * Spec requirement: the `AuthenticationError` recovery path
 * SHALL NOT echo the rejected token. Because the SDK puts the
 * raw token in the error message (it's an internal-only message
 * never meant for the model), we redact that subclass's
 * `structuredContent.error.message` to a fixed string.
 */
export function mapSdkError(error: WhatsAppError): ToolErrorResponse {
  const safeMessage =
    error instanceof AuthenticationError
      ? "Meta rejected the access token. Message redacted to avoid leaking credentials into the MCP transcript."
      : error.message;
  return {
    content: [{ type: "text", text: recoveryHint(error) }],
    isError: true,
    structuredContent: {
      error: {
        code: error.code,
        message: safeMessage,
      },
    },
  };
}

/**
 * Tool-handler wrapper. Catches `WhatsAppError` subclasses and
 * returns the mapped response; rethrows everything else so the
 * MCP framework surfaces it as a JSON-RPC protocol error.
 */
export async function withErrorMapping<T>(fn: () => Promise<T>): Promise<T | ToolErrorResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WhatsAppError) return mapSdkError(e);
    throw e;
  }
}
