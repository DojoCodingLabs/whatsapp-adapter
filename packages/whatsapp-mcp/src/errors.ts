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
  AccountRestrictedError,
  AuthenticationError,
  CapabilityError,
  MissingCredentialsError,
  NetworkError,
  OptOutError,
  PermissionError,
  RateLimitError,
  RequestAbortedError,
  TemplateError,
  TransientError,
  UndeliverableError,
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
  if (error instanceof UndeliverableError) {
    return "The recipient is unreachable on WhatsApp (not registered, outdated client, or has not accepted current Terms of Service). This is NOT the same as a closed 24-hour window — sending a template will not help. Do not retry; surface the failure to a human operator so they can reach the customer through another channel.";
  }
  if (error instanceof OptOutError) {
    const scope = error.category ? ` of ${error.category}` : "";
    const authoritative =
      error.metaCode === 131050
        ? " Meta reported this opt-out (error 131050), so it is authoritative — record it in the consent ledger and do not retry marketing sends to this recipient."
        : "";
    return `The recipient has opted out${scope}.${authoritative} Record explicit consent via your opt-in flow / consent ledger before re-sending. Templates of a different category may still be allowed if the opt-out is category-scoped.`;
  }
  if (error instanceof TemplateError) {
    const code = error.metaCode !== undefined ? ` (Meta error ${error.metaCode})` : "";
    return `Template send failed${code}: ${error.message}. Inspect the template with \`whatsapp_get_template\` to verify the variable count, language code, and approval status, then retry.`;
  }
  if (error instanceof RateLimitError) {
    if (error.metaCode === 131049) {
      return "Meta declined this marketing message because the recipient has already received the maximum number of marketing messages for the period (error 131049). Do not retry this recipient for at least 24 hours; send a UTILITY template if the content is transactional.";
    }
    if (error.metaCode === 131064) {
      return "Meta has reduced this phone number's messaging limit after template-classification violations (error 131064). Retrying will not help; the operator should review template categories in WhatsApp Manager.";
    }
    const retry = error.retryAfterMs;
    return retry !== undefined
      ? `Meta rate-limited this send (retryAfterMs=${retry}). Wait at least ${retry} ms before retrying, or reduce send concurrency.`
      : "Meta rate-limited this send. Wait before retrying, or reduce send concurrency.";
  }
  if (error instanceof AccountRestrictedError) {
    return "Meta has restricted or locked this WhatsApp Business Account (integrity enforcement). No send will succeed until the operator resolves it in WhatsApp Manager / Business Support Home. Stop attempting sends and surface this to a human.";
  }
  if (error instanceof TransientError) {
    const status = error.httpStatus !== undefined ? ` (HTTP ${error.httpStatus})` : "";
    return `Meta's API was unavailable${status} and the SDK exhausted its retries. The message may or may not have been delivered — check the conversation before re-sending to avoid a duplicate. Retry once after a short pause.`;
  }
  if (error instanceof NetworkError) {
    return "The server could not reach graph.facebook.com (DNS / TCP / TLS failure). The request never reached Meta, so it is safe to retry once connectivity is restored; if it persists, the operator should check outbound network access.";
  }
  if (error instanceof RequestAbortedError) {
    return "The request was cancelled before completing. Retry if the cancellation was not intended.";
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
