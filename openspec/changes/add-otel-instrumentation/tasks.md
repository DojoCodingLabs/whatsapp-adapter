## 1. Dev dependencies

- [ ] 1.1 `pnpm add -D @opentelemetry/sdk-trace-base @opentelemetry/sdk-trace-node` (in-memory exporter for tests).

## 2. Tracing helpers

- [ ] 2.1 Create `src/observability/tracing.ts` exporting `withSpan(name, fn, attributes?)` and `getTracer()`. Records exceptions; sets `SpanStatusCode.ERROR` on rejection.
- [ ] 2.2 Add `test/unit/observability/tracing.test.ts` (in-memory exporter): success span; error span with status + exception event; attribute application; no-op-tracer no-throw.

## 3. Redaction helpers

- [ ] 3.1 Create `src/observability/redact.ts` exporting `hashPhoneNumberId(value)`, `setRedactSalt(salt)`, and attribute-builder helpers `redactedSendAttributes` / `redactedWebhookAttributes`.
- [ ] 3.2 Add `test/unit/observability/redact.test.ts`: stable hash, hash differs from raw, different inputs → different hashes, salt change → different output.

## 4. Wire into transport

- [ ] 4.1 Update `src/client/transport.ts` so each `request<T>()` call is wrapped in `withSpan("whatsapp.request", ...)`. On non-2xx, record `whatsapp.error.code` and (if present) `whatsapp.error.meta_code`.

## 5. Wire into webhook receiver

- [ ] 5.1 Update `src/webhooks/receiver.ts#runHandler` to wrap every handler invocation in `withSpan("whatsapp.webhook.dispatch", ...)` with redacted attributes.

## 6. Public surface

- [ ] 6.1 `src/observability/index.ts` re-exports `withSpan`, `getTracer`, `hashPhoneNumberId`, `setRedactSalt`.
- [ ] 6.2 `src/index.ts` re-exports the observability module.

## 7. Integration tests

- [ ] 7.1 Add `test/contract/observability/transport-spans.test.ts`: a successful request emits a `whatsapp.request` span with hashed phoneNumberId; a 131056 failure emits an ERROR span with `error.code === "RATE_LIMIT"` and `error.meta_code === 131056`.
- [ ] 7.2 Add `test/contract/observability/dispatch-spans.test.ts`: a successful handler emits one `whatsapp.webhook.dispatch` span; a throwing handler emits an ERROR span with the exception event.

## 8. Verification

- [ ] 8.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [ ] 8.2 `pnpm test:coverage` — gates honoured.
- [ ] 8.3 `pnpm build` — `withSpan`, `getTracer`, `hashPhoneNumberId`, `setRedactSalt` all in `dist/index.d.ts`.
- [ ] 8.4 `openspec validate add-otel-instrumentation --strict` passes.
