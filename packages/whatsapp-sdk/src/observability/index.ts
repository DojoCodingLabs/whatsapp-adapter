// Capability: observability (Phase 7). OpenTelemetry spans + redacted
// attributes; no-op when no global tracer is registered.

export { DEFAULT_REDACT_SALT, hashPhoneNumberId, setRedactSalt } from "./redact.js";
export { getTracer, withSpan } from "./tracing.js";
