## Why

`openspec/config.yaml` mandates an OTel span on every Graph API call and every webhook handler invocation, with redacted attributes (hashed `phone_number_id`, no body bytes). Today the SDK has zero tracing — every send and every dispatch is silent. Phase 7 introduces the `observability` capability: a thin `withSpan` wrapper, a PII-redacting attribute helper, and the wiring in `transport.ts` and `receiver.ts`. When no global tracer is registered (the default; `@opentelemetry/api` ships a no-op tracer), the wrappers are zero-overhead.

## What Changes

- **NEW** capability `observability`.
- **NEW** `src/observability/tracing.ts`:
  - `getTracer()` returns the SDK's tracer instance from `@opentelemetry/api` (`trace.getTracer("@dojocoding/whatsapp", VERSION)`).
  - `withSpan(name, fn, attributes?)` async wrapper that creates a span around `fn`, applies attributes, records exceptions and sets the span's status on error.
- **NEW** `src/observability/redact.ts`:
  - `hashPhoneNumberId(phoneNumberId)` returns a stable, salted SHA-256 hex prefix (16 chars) so spans correlate across runs without leaking the real id. Salt is set once via `setRedactSalt(salt)` (defaults to a constant baked into the build for dev — consumers in prod set their own).
  - `redactedSendAttributes(client, payload)` and `redactedWebhookAttributes(event)` produce the standard attribute set (hashed phoneNumberId, hashed wabaId, message type, error code if any, etc.).
- **MODIFIED** `src/client/transport.ts`: every `request()` call is wrapped in `withSpan("whatsapp.request", …, attributes)`; on non-2xx the span records the typed error and `error.code` attribute.
- **MODIFIED** `src/webhooks/receiver.ts`: every handler invocation in `_dispatch` is wrapped in `withSpan("whatsapp.webhook.dispatch", …, attributes)`; the span records exceptions thrown by handlers.
- **NEW** dev dependencies: `@opentelemetry/sdk-trace-base` and `@opentelemetry/sdk-trace-node` for tests using the in-memory exporter.
- **NEW** `src/observability/index.ts` re-exports `withSpan`, `getTracer`, `hashPhoneNumberId`, `setRedactSalt`.

## Capabilities

### New Capabilities
- `observability`: tracing helpers + redaction.

### Modified Capabilities
- `cloud-api-client`: adds the requirement that every `request()` call emits a span.
- `webhook-receiver`: adds the requirement that every handler dispatch emits a span.

## Non-goals

- **No metrics or logs API**: only tracing in v1. Metrics layer in a future change.
- **No automatic OTel SDK setup**: the SDK uses `@opentelemetry/api` directly; consumers pick their exporter (Honeycomb, Tempo, OTLP, …) and register a tracer provider via standard OTel SDK init.
- **No distributed-trace propagation through Meta**: the Graph API doesn't echo `traceparent` headers, so context lives only within one process boundary.
- **No span over the whole `sendText`/`sendImage` builder + transport pipeline as a single span**: each step is its own span. Consumers wanting a parent span should wrap their own.

## Impact

- **Code**: net-new `src/observability/{tracing.ts,redact.ts,index.ts}`. `transport.ts` and `receiver.ts` get one wrapping call each. `src/index.ts` re-exports the observability module.
- **APIs**: `withSpan`, `getTracer`, `hashPhoneNumberId`, `setRedactSalt` become public. No breaking changes.
- **Dependencies**: `@opentelemetry/api` already a peer dep. Tests add `@opentelemetry/sdk-trace-base` and `@opentelemetry/sdk-trace-node` as devDeps.
- **Systems**: tests use OTel's in-memory span exporter to assert span names, attributes, and statuses.
