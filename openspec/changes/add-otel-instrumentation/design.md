## Context

The SDK has been observability-blind through Phase 6. Operators running the adapter in production need to see request rates, error codes, retry storms, and handler latencies — and the natural carrier is OpenTelemetry. Phase 7 adds the spans, keeps PII out of attributes, and stays zero-overhead when no SDK is registered.

Domain rules from `openspec/config.yaml` `context` that this design must satisfy:
- Spans on every external API call AND every webhook handler invocation.
- PII is redacted: `phone_number_id` is hashed, request/response bodies are NEVER attached.
- Multi-tenant by construction: spans must scope by hashed phone number / WABA so cardinality stays bounded.
- No `any` in production code.

## Goals / Non-Goals

**Goals:**
- A `withSpan(name, fn, attributes?)` wrapper that's the single touch point.
- A tiny PII redaction layer (hash, no raw ids in attributes).
- Wired into transport (`request`) and receiver (`#runHandler`) — only those two spots.
- Tests with the OTel in-memory exporter that assert span names, attributes, and status.
- Zero-overhead when no SDK is registered (the OTel API's default tracer is a no-op).

**Non-Goals:**
- No metrics layer in v1 (counters / histograms). Future change.
- No automatic OTel SDK init — consumers BYO tracer provider via `NodeTracerProvider`/`BasicTracerProvider`.
- No span over the entire `client.sendText` (builder + transport) as one span — each step is its own span; consumers wanting a parent span wrap on their side.
- No trace propagation through Meta — the Cloud API doesn't echo `traceparent`.

## Decisions

### Decision: `withSpan` is async-only
**Rationale.** Every call site that needs a span (transport, receiver dispatch) is already async. A sync variant would double the API surface for no real callers in this phase. If a future call site needs sync, we'll add it then.
**Alternatives considered.** Sync + async overloads (more surface, no benefit today). Use the OTel API directly at every call site (more boilerplate, harder to keep consistent).

### Decision: hashPhoneNumberId returns a 16-hex prefix, not a full SHA-256
**Rationale.** Spans are cardinality-sensitive in observability backends. A 16-char hex (64 bits of entropy) is enough to disambiguate phone numbers across a typical org while halving the per-span attribute size. Collision probability among a million phone numbers is ~`2.7e-8` — fine for the cardinality use case (and we don't claim cryptographic uniqueness).
**Alternatives considered.** Full 64-char hex (4× the bytes, no real benefit). Truncated to 8 chars (collisions visible at ~10K phones). Not hashing at all (PII leak).

### Decision: `setRedactSalt` is a process-global setter, not a constructor option
**Rationale.** Redaction salt has to be consistent across every span emission within a process. Threading it through every constructor would be invasive. A module-level setter, with a documented dev-default, is the simplest correct shape.
**Alternatives considered.** Constructor option (every client + receiver + mock has to take it; cumbersome). Read from env (less explicit; debugging-hostile when the env varies across deployments).

### Decision: spans on `request()` use a "client" `SpanKind` semantically, but we omit it in v1
**Rationale.** `SpanKind.CLIENT` is the right semantic but requires an OTel SDK to actually surface differently from `INTERNAL`. v1 keeps `INTERNAL` (the `withSpan` default) so the test in-memory exporter doesn't have to special-case kinds; a follow-up can mark it `CLIENT` when the production exporter starts caring.
**Alternatives considered.** Mark them `CLIENT` from day 0 (more code; observable difference is exporter-dependent).

### Decision: handler-dispatch spans go INSIDE the receiver's per-handler `try`/`catch`
**Rationale.** The receiver swallows handler exceptions to keep the dispatch loop running and fire the `error` event. The span has to *see* the exception even though the receiver swallows it. Wrapping inside the try means the span records the exception and sets ERROR status, then the receiver's existing error handling proceeds.
**Alternatives considered.** Wrap outside the try (loses exception recording on the handler that owns the span). Re-throw after recording (breaks existing behaviour).

```
              ┌───────────────────────────────────┐
              │      transport.request<T>         │
              │ withSpan("whatsapp.request", …)   │
              │   - hashed phone_number_id        │
              │   - method / path                 │
              │   - idempotency_key               │
              │   on error: error.code, meta_code │
              └───────────────────────────────────┘

              ┌───────────────────────────────────┐
              │      receiver.#runHandler         │
              │ withSpan("whatsapp.webhook.       │
              │           dispatch", …)           │
              │   - event.kind                    │
              │   - hashed waba_id, phone_number  │
              │   - event.id (wamid; not PII)     │
              │   on throw: status=ERROR + event  │
              └───────────────────────────────────┘
```

## Risks / Trade-offs

- **Risk:** A consumer registers an OTel SDK that mutates spans synchronously and is slow. **Mitigation:** the in-memory exporter we use in tests is millisecond-cheap; production exporters batch. We document the cost as the consumer's exporter choice.
- **Risk:** `setRedactSalt` is module-global so a consumer who never calls it leaks the dev default's hash space. **Mitigation:** docs are explicit ("set this in production"); the dev default produces stable hashes that are still NOT the raw id (so no PII leaks regardless).
- **Trade-off:** Hash truncated to 16 hex (vs 32). Trades collision probability for attribute size. Acceptable.
- **Trade-off:** Spans on every handler dispatch can be noisy. Consumers can sample at the SDK level if needed; we don't sample inside the SDK.

## Migration Plan

Additive — no consumer breakage. Spans appear immediately if a consumer has an OTel SDK already wired, otherwise they no-op.

## Open Questions

- Should we mark transport spans `SpanKind.CLIENT` and dispatch spans `SpanKind.CONSUMER`? **Tentative:** yes in v1.1; v1 stays INTERNAL.
- Should handler-dispatch spans be parented to the inbound HTTP request? **Tentative:** would require thread-local context propagation through `handlePayload` → `_dispatch`. Out of scope for v1.
