# `@dojocoding/whatsapp-sdk` — Deep Audit (2026-09-07)

Scope: `packages/whatsapp-sdk` at `cb326f0` (+ uncommitted
agent-bridge WIP). Method: full gate run, line-by-line source review
of every capability, 20 targeted probe tests written against the
real code paths (msw-backed, then deleted), and cross-checks against
Meta's official documentation as of today.

Meta sources consulted:

- Graph API versions / changelog:
  `developers.facebook.com/docs/graph-api/changelog/versions/`,
  `.../changelog/version26.0/`
- WhatsApp error codes:
  `developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes`
- Platform overview (throughput / pair rate limits):
  `developers.facebook.com/docs/whatsapp/cloud-api/overview/`
- WhatsApp Business Platform changelog (Nov 2024 → Jul 2026):
  `developers.facebook.com/docs/whatsapp/business-platform/changelog/`
- Pricing — non-template messages (Oct 1, 2026 change):
  `developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages`

---

## 1. Scorecard

| Area                                  | Verdict                   |
| ------------------------------------- | ------------------------- |
| Typecheck / lint / build / size       | Pass                      |
| Test suite (75 files, 720 tests)      | Pass                      |
| Coverage thresholds (90/85/90/90)     | Pass (92.9 / 88.0 / 94.4) |
| `openspec validate --specs --strict`  | Pass (12/12)              |
| `prettier --check`                    | **Fail** (7 files, WIP)   |
| Webhook security (HMAC, handshake)    | Correct                   |
| 24 h window gate + template exemption | Correct semantics, 1 bug  |
| Error-code mapping vs Meta table      | **4 misclassifications**  |
| Credential hygiene                    | **1 leak (OTel span)**    |
| Graph API pin                         | v25.0 (current is v26.0)  |
| Public-API test pairing               | 3 methods lack HTTP tests |

Overall: the SDK is well-built and the core invariants (raw-body
HMAC, 30 s ack, typed errors, zero global state, mock parity) are
genuinely enforced. The defects below are concentrated in the
edges — error taxonomy, observability redaction, and the
`validateAgainst` / `WindowTracker` pre-flight paths that the
docs actively recommend.

---

## 2. Verification run

```
pnpm typecheck                 → exit 0
pnpm lint                      → exit 0
pnpm test:coverage             → 75 files / 720 tests pass
pnpm build                     → exit 0 (ESM + CJS + d.ts)
pnpm size                      → all 7 budgets pass (root 19.9 kB brotli)
pnpm format:check              → FAIL: 7 files (see F21)
openspec validate --specs      → 12 passed
```

Coverage hot spots (from the v8 report):

| File                                 | Lines  | Note                                             |
| ------------------------------------ | ------ | ------------------------------------------------ |
| `src/media/download.ts`              | 1.66 % | `downloadMedia` + `fetchMediaUrl` never executed |
| `src/media/upload.ts`                | 19.4 % | only `buildUploadForm` / constants tested        |
| `src/conversation-acks/mark-read.ts` | 69.6 % | `sendMarkRead` HTTP path never executed          |

The global thresholds still pass because these files are small; the
per-file picture is what matters (see F14).

---

## 3. Findings

Severity legend — **H**: production-visible bug or credential/PII
issue; **M**: correctness gap that will bite a real consumer;
**L**: hygiene, docs, or forward-compat.

Each finding was confirmed by a probe test run against the real
code (probe IDs P1–P12, Q1–Q6). Probe sources are in § 6.

### 3.1 High

#### F1 (H) — Bearer token leaks into OTel spans via `healthCheck`

- `src/client/health.ts:42` builds
  `/debug_token?input_token=${encodeURIComponent(token)}`.
- `src/client/transport.ts:154` records the full path as the
  `whatsapp.path` span attribute.
- **Probe P1:** `whatsapp.path` = `/debug_token?input_token=SECRET-TOKEN-abc123`.
- Violates `openspec/config.yaml` "errors/spans never carry
  credential values" and the PII-redaction requirement in
  `observability` spec. Any span exporter (Honeycomb, Datadog,
  Tempo) now stores the long-lived System User token.
- Fix: strip the query string before attaching `whatsapp.path`
  (`path.split("?")[0]`), or move `input_token` into the request
  body/header. Add a negative-path test in
  `test/contract/observability/transport-spans.test.ts` asserting no
  span attribute contains the token. Also audit
  `span.recordException(err)` / `setStatus({message})` — Meta error
  messages don't echo tokens today, but the health path should
  redact defensively.

#### F2 (H) — `131053` is a permanent media-upload error, not a rate limit

- `src/client/errors.ts:31` puts `131053` in
  `RETRYABLE_RATE_LIMIT_CODES` with comment "Media-upload throttle".
- Meta's table: `131053` = "Unable to upload the media used in the
  message … such as an unsupported media type." Not in Meta's
  throttling group (which is `4`, `80007`, `130429`, `131048`,
  `131056`, `133016`, `131064`).
- **Probe P10:** `mapMetaError(400, {code: 131053})` →
  `RateLimitError`, retried 4× with backoff.
- Impact: a bad MIME type is retried four times (~1–8 s wasted per
  send) and surfaces as `RateLimitError`, sending consumers down the
  "queue and retry later" branch for a permanent failure.
- The misclassification is baked into `openspec/specs/cloud-api-client/spec.md:262`,
  `docs/compliance.md:188`, `docs/sdk/client.md:164,196`,
  `docs/sdk/patterns.md:331`, `docs/architecture.md:126`,
  `docs/compatibility.md:75`, and
  `test/unit/client/errors.test.ts:28,152`. All must move together
  in one OpenSpec change.
- Fix: map `131053` → `CapabilityError` (or a new
  `MediaError`), non-retryable. See F7 for the codes that should
  take its place.

#### F3 (H) — `validateAgainst` rejects valid media-header templates

- `src/templates/validate.ts:57-66` counts `{{N}}` placeholders in
  `defComp.text` and demands `parameters.length` equal that count.
- Meta's `HEADER` component with `format: IMAGE|VIDEO|DOCUMENT|LOCATION`
  has **no `text`** but requires exactly one media/location
  parameter at send time.
- **Probe P4:** approved definition with `HEADER format:"IMAGE"` +
  a correct payload → `TemplateError: Template component "header"
expects 0 parameter(s) but payload provided 1.`
- Impact: every consumer following `AGENTS.md` ("Use
  `validateAgainst: definition` to catch mismatches pre-flight") is
  blocked from sending any media-header template. This is the most
  common UTILITY template shape (order updates with an image).
- Fix: in `validateTemplateSend`, when `defComp.type === "HEADER"`
  and `defComp.format !== "TEXT"`, expect exactly one parameter
  whose `type` matches `format.toLowerCase()`.

#### F4 (H) — `WindowTracker.notifyInbound` ignores the inbound timestamp

- `src/window/tracker.ts:40-46` accepts `_atMs` but always writes
  `set(key, true, ttlMs)` from _now_.
- Meta retries webhooks with backoff for up to 7 days; a first
  delivery that arrives late (or a replay from a queue) re-opens a
  24 h window from receipt time, not from the customer's message.
- **Probe P6:** `notifyInbound(wa, now − 30 h)` → `isWindowOpen` =
  `true`. Meta would reject the subsequent free-form send with
  `131047`.
- The `MessageEvent.timestamp` is already parsed to epoch-ms by
  `parser.ts:346-353`; nothing passes it through. The new
  agent-bridge (`src/agent-bridge/bridge.ts:43`) also calls
  `notifyInbound(event.from)` without it.
- Fix: compute `remaining = ttlMs − (now − atMs)`; skip the write
  when `remaining <= 0`; pass `event.timestamp` from the bridge and
  every cookbook. Add a unit test for late delivery.

#### F5 (H) — Exhausted retries surface non-`WhatsAppError` classes

- `src/client/retry.ts:150-175` rethrows the last error verbatim.
  For HTTP 408/429/5xx that is `TransientHttpError` (plain `Error`
  subclass, `retry.ts:62`); for DNS/TCP failure it is `TypeError`;
  for a 2xx with a non-JSON body (`transport.ts:244`) it is
  `SyntaxError`.
- **Probes P2, P2b, P11:** 503×4 → `TransientHttpError`;
  429-no-envelope×4 → `TransientHttpError` (never `RateLimitError`);
  200 + HTML → `SyntaxError`.
- Violates the "errors are typed classes extending `WhatsAppError`"
  hard rule. `docs/compliance.md:197` claims "eventually
  `WhatsAppError` if retries exhausted" — false. Consumers using the
  documented `instanceof WhatsAppError` catch-chain fall into
  `else throw err`.
- Fix: wrap the final error in `transport.ts` — `TransientHttpError`
  status 429 → `RateLimitError({ retryAfterMs })`; other transient →
  new `TransientError`/`WhatsAppError("TRANSIENT")`; network
  `TypeError` → `WhatsAppError("NETWORK", …, { cause })`; JSON parse
  failure → `WhatsAppError("UNKNOWN", …, { cause })`. Keep
  `TransientHttpError` internal.

### 3.2 Medium

#### F6 (M) — User-initiated `AbortSignal` is treated as retryable

- `src/client/retry.ts:182` (`shouldRetry`) and `:213` classify
  `AbortError` as `"abort"` → retry.
- **Probe P3:** pre-aborted signal → 3 retries scheduled, 0 network
  hits, full backoff sleeps (up to ~8 s with defaults) before the
  caller's own cancellation is honoured.
- Fix: if `signal?.aborted` after a failure, rethrow immediately
  (wrapped as `WhatsAppError("ABORTED")` or re-thrown as the
  `AbortError`). Retry only _timeouts_ the SDK itself imposes.

#### F7 (M) — Throttling codes `4` and `80007` are not recognised

- Meta lists `4` (app-level rate limit) and `80007` (WABA-level
  rate limit) as throttling errors that should be retried after
  backoff. `mapMetaError` returns `WhatsAppError("UNKNOWN")` for
  both (Probe P10), so the SDK does **not** retry them and consumers
  cannot `instanceof RateLimitError`.
- `80007` is the code you hit on `listTemplates` / `getTemplate`
  polling (200 req/h default WABA budget) — exactly the calls an
  LLM orchestrator makes often.
- Also new since the May-2026 pass: `131064` (Apr 17, 2026 —
  messaging limit due to template classification violations) and
  `133016`. Both belong in the rate-limit class but should be
  **non-retryable** (enforcement periods are hours/days).
- Fix: add `4`, `80007` to `RETRYABLE_RATE_LIMIT_CODES`; add
  `131064`, `133016` to a new non-retryable rate-limit set (still
  `RateLimitError`, `isRetryableError` → `false`).

#### F8 (M) — Marketing opt-out signals are invisible to the SDK

- `131050` ("recipient has chosen to stop receiving marketing
  messages … do not retry") and `131049` (per-user marketing
  frequency cap, "wait ≥ 24 h") both map to `UNKNOWN` (Probe P10).
- The `user_preferences` webhook field (added by Meta Nov 18, 2024)
  is unparsed — it falls through to `kind: "unknown"` (Probe P9).
- The SDK ships an `OptInRegistry` precisely to gate MARKETING
  sends, yet gives consumers no typed hook to _populate_ it from
  Meta's authoritative opt-out signal. Meta's Apr 30, 2026 changelog
  adds WABA-level enforcement for excessive `131049` retries —
  consumers that blindly retry `UNKNOWN` now risk account-level
  penalties.
- Fix: `131050` → `OptOutError` (or `MarketingOptOutError`),
  `131049` → new `FrequencyCapError`; add a
  `user_preferences` parse branch producing
  `{ kind: "user_preferences", waId, category, value: "stop"|"resume", detail }`
  (follows the "Add support for a new webhook event kind" recipe in
  `AGENTS.md`); document wiring it to `registry.optOut()`.

#### F9 (M) — Auth/permission mapping misses Meta's documented codes

- `AUTH_CODES = {190}` only. Meta's authorization group also lists
  `0` (unable to authenticate app user), `3`, `10` (permission not
  granted), `131005` (permission not granted / removed). Probe P10:
  `131005` → `UNKNOWN`.
- `200` is currently in `PERMISSION_CODES`; Meta documents it (for
  WhatsApp) as "No access token was provided" — arguably
  `AuthenticationError`. Low-stakes, but the `docs/compliance.md` §4
  table should say what it actually is.
- Integrity codes `368`, `130497`, `131031` (account
  restricted/disabled) → `UNKNOWN`; an `AccountRestrictedError`
  would let orchestrators halt a campaign instead of retrying per
  message.

#### F10 (M) — `TemplateError` from Meta drops the code

- `errors.ts:125-127` collapses all `132xxx` into
  `TemplateError(message)` — no `metaCode`, no `templateName`
  (Probe P12).
- `132001` (does not exist / not approved), `132015` (paused),
  `132016` (permanently disabled), `132000` (param count),
  `132012` (param format), `132018` (validation, new) require
  different operator actions. Consumers are back to parsing
  `message`.
- Fix: add `metaCode?: number` to `TemplateError`; include it in
  `extractMetaCode` (`transport.ts:188-194`) so
  `whatsapp.error.meta_code` is emitted.

#### F11 (M) — Flows replies and CTWA welcome triggers parse as `"unsupported"`

- `src/webhooks/parser.ts:184-197` handles `interactive.type` of
  `button_reply` / `list_reply` only; `nfm_reply` (WhatsApp Flows
  completion, `response_json`) becomes `"unsupported"`.
- `type: "request_welcome"` (sent when a user opens a CTWA
  conversation before typing — the trigger for a welcome message
  inside the 72 h free entry-point window) is also `"unsupported"`.
- **Probe P8** confirms both. The `body` still carries the raw
  payload, so consumers _can_ dig it out, but `type` is the
  documented discriminator and `"unsupported"` is also what Meta
  sends for genuinely unsupported messages — the two are now
  indistinguishable.
- Fix: add `"interactive_nfm_reply"` and `"request_welcome"` to
  `IncomingMessageKind` + `KNOWN_INCOMING_KINDS`; fixtures under
  `test/__fixtures__/webhooks/`.

#### F12 (M) — `fetchMediaUrl` bypasses the transport pipeline

- `src/media/download.ts:71-91` calls global `fetch` directly: no
  OTel span, no `fetchImpl` override, no retry, no `Retry-After`,
  and any non-2xx becomes `WhatsAppError("UNKNOWN")`.
- **Probe Q2:** zero spans emitted during `fetchBytes()`. Violates
  "every external API call gets an OTel span".
- The CDN host (`lookaside.fbsbx.com` / `scontent…`) is not Graph,
  so `request()` can't be reused as-is; add a sibling
  `fetchExternal()` in `transport.ts` that shares span/retry/
  `fetchImpl` and maps 401/403/404 → `MediaExpiredError` (URL TTL
  is 5 min per Meta).

#### F13 (M) — Mock ↔ real divergence and untyped throws

- `MockWhatsAppClient.uploadMedia` (`src/mock/client.ts:213-229`)
  performs no size gating; the real client rejects >5 MB images.
  **Probe Q4:** mock accepts a 6 MB `image/jpeg` the real client
  throws on. Parity spec says mock "satisfies the same public
  interface … and is parity-tested" — the parity test doesn't cover
  media.
- Non-`WhatsAppError` throws on public methods: `sendReply` →
  `Error` (`whatsapp-client.ts:482`, Probe P7); `uploadMedia`,
  `getTemplate`, `markAsRead` → `TypeError`
  (`upload.ts:82-87`, `api.ts:25-27`, `mark-read.ts:43-45`);
  `coerceToBlob` → `Error`. Builders correctly throw
  `WhatsAppError("UNKNOWN")` for the same class of input error, so
  the surface is inconsistent.
- Fix: export the size-gate helper from `media/upload.ts` and reuse
  it in the mock; replace ad-hoc `TypeError`/`Error` with
  `WhatsAppError("UNKNOWN" | "CAPABILITY")`; extend
  `test/parity/send-parity.test.ts` with upload/download/markAsRead.

#### F14 (M) — Three public methods have no HTTP-contract test

- `uploadMedia`, `downloadMedia`, `markAsRead` (all shipped in
  `cb326f0`) have builder/mock unit tests but no msw-backed
  contract test. `download.ts` is at 1.66 % line coverage.
- Probes Q1–Q3 show the wire shapes are actually **correct**
  (multipart `messaging_product`/`type`/`file`; `GET /{media-id}` →
  bearer fetch; `{status:"read", message_id, typing_indicator:{type:"text"}}`),
  so this is a test-hygiene finding, not a bug — but
  `AGENTS.md` says every public-API change pairs with a test at
  the right layer.
- Fix: add `test/contract/media/upload.test.ts`,
  `download.test.ts`, `test/contract/conversation-acks/mark-read.test.ts`.

#### F15 (M) — Named template parameters unsupported

- Meta templates may use `parameter_format: "NAMED"` with
  `{{customer_name}}` placeholders and send-time
  `{ type:"text", parameter_name:"customer_name", text:"Ana" }`.
- `src/templates/placeholders.ts:3` regex is digits-only, so a
  NAMED body counts 0 placeholders → `validateAgainst` rejects the
  correct payload. `TemplateParameterText` (`messages/types.ts:208`)
  lacks `parameter_name`; `TemplateDefinition` lacks
  `parameter_format`.
- Fix: widen regex to `\{\{\s*([A-Za-z0-9_]+)\s*\}\}`, branch on
  `definition.parameter_format`, add `parameter_name?: string`.

#### F16 (M) — Numeric button `index` rejected by the validator

- `TemplateComponent.index?: string | number`
  (`messages/types.ts:289`) — but `validate.ts:88-94` only accepts
  strings. **Probe P5:** `index: 0` → `TemplateError: requires a
numeric index string`. Type and runtime disagree.
- Fix: `Number(idxRaw)` for both.

### 3.3 Low / documentation / hygiene

#### F17 (L) — Graph API pin is one version behind

- SDK: `v25.0` (released Feb 18, 2026, supported to Jul 29, 2028).
  Meta current: **`v26.0`** (Jul 29, 2026). No WhatsApp Cloud API
  breaking changes in v26.0 affect this SDK's surface, so the pin is
  safe — but the per-repo policy is "pin current".
- `AGENTS.md` says the bump touches "~17 places" in tests; it is now
  **63** hardcoded `v25.0` sites under `test/`. Update the recipe or
  centralise the URL prefix in a test helper.
- `src/messages/types.ts:2` header still says "Graph API v23".

#### F18 (L) — `docs/compliance.md` § 4 table is wrong in three rows

- Line 189: `131026` labelled "24-hour window closed →
  `WindowClosedError`". The code is `131047`; `131026` is
  `UndeliverableError`. This contradicts the repo's own hard rule
  in `CLAUDE.md`.
- Missing rows for `UndeliverableError` (`131026`) and `OptOutError`.
- Line 197: "eventually `WhatsAppError` if retries exhausted" —
  false (F5).
- Line 188: `131053` "media-upload throttle" — false (F2).

#### F19 (L) — Stale JSDoc

- `whatsapp-client.ts:86-92` (`windowTracker` option) says
  "`sendTemplate` and `sendReaction` are window-exempt". Reactions
  are gated (correctly, at `:414-420`). The option doc is the first
  thing a consumer reads.
- `events.ts:138` `pricingCategory` comment says `"CBP" vs "PMP" vs
"regular"` — those are `pricing_model`/`type` values, not
  `category`. Since v24.0 Meta also omits the `conversation` object
  except in free-entry-point windows, so `conversationId` is
  usually absent; document that. Consider surfacing
  `pricing.type` (`regular | free_customer_service | free_entry_point`)
  and `billable` — they become financially material on Oct 1, 2026
  (F24).

#### F20 (L) — Release/version story is inconsistent

- `package.json` = `0.9.0`; latest tag `sdk-v0.9.0`; `CHANGELOG.md`
  "Unreleased … ships in `sdk-v1.1.0` (the first post-`1.0.0`
  minor)" — there is no `1.0.0` tag; commit `ee8717f` says
  `sdk-v1.1.0`; `CLAUDE.md` says "published as `0.8.x`"; `AGENTS.md`
  references `v0.8.3`. Pick one story before the next publish.

#### F21 (L) — Uncommitted agent-bridge WIP fails the gate

- `git status`: new `src/agent-bridge/`, spec, tests, and 4 docs are
  untracked; `src/index.ts` re-exports it. `prettier --check` fails
  on 7 files including `src/agent-bridge/types.ts`. Pre-commit
  hooks will block this.
- `bridge.ts:56-60, 74-76, 88-90, 111-113`: every failure path is
  `onError?.(err, event)` — when `onError` is not supplied, errors
  are swallowed silently (contra "never silently catch and swallow").
  Default `onError` to `console.error` like the adapters do.
- `bridge.ts:43` — pass `event.timestamp` once F4 lands.

#### F22 (L) — Dedupe-before-dispatch means a failed handler is never retried

- `receiver.ts:152-168` marks the wamid seen _before_ running
  handlers. **Probe Q6:** handler throws → Meta's retry is deduped →
  event lost after one attempt.
- This is a defensible design (Meta's retry is not a work queue),
  but it is undocumented in `docs/sdk/webhooks.md` and surprises
  people who expect at-least-once. Document it, and/or offer
  `dedupeAfterSuccess: true` for consumers with idempotent handlers.

#### F23 (L) — No pre-flight length validation on free-form payloads

- Builders check presence/shape but not Meta's hard limits: text
  body 4096, caption 1024, interactive body 1024, footer 60, header
  text 60, button title 20, list button 20, row title 24, row
  description 72, section title 24. Today these round-trip to Meta
  and come back as `100`/`131009` → `CapabilityError`. Cheap to add,
  and the LLM-orchestrator use case generates over-long text often.

#### F24 (L) — Oct 1, 2026 pricing change is not reflected in docs

- Meta: from Oct 1, 2026 every free-form (service) message and every
  in-window UTILITY template is billed per message; only the 72 h
  free entry-point window (CTWA / FB CTA) stays free. Payment method
  required by Sep 30, 2026.
- `docs/compliance.md` § "what the consumer must enforce" should
  call this out; `MessageEvent.referral` + `request_welcome` (F11)
  are the signals for the free window; `StatusEvent` should surface
  `pricing.type` (F19) so consumers can reconcile invoices.

#### F25 (L) — Newer platform surface not modelled (roadmap candidates)

- `biz_opaque_callback_data` (send + status webhook) — the
  Meta-native correlation id; more useful than the SDK's
  `X-Request-Id`.
- `message_send_ttl_seconds` on template sends.
- `messaging_account_id` (Jun 16, 2026; `paid_messaging_account_id`
  deprecated Dec 31, 2026).
- Direct Send API (open beta, Jun 15, 2026) — utility/auth without
  pre-created templates.
- Interactive kinds `location_request_message`, `address_message`,
  `flow`, `product`/`product_list`.
- Template button sub-types `flow`, `catalog`, `mpm`, `voice_call`.
- Webhook fields `account_update`, `message_echoes`,
  `calls`, `business_capability_update` (all land in `unknown`
  today, which is the correct forward-compat behaviour).

---

## 4. Verified correct against Meta

Worth recording so the next pass doesn't re-litigate:

- HMAC-SHA256 over raw bytes, constant-time compare, `sha256=`
  prefix tolerance (`signature.ts`); handshake constant-time
  (`handshake.ts`); adapters read bytes exactly once and ack 200
  before dispatch (`web/index.ts`, `express/index.ts` incl.
  `application/json; charset=utf-8` — Probe Q5).
- Window semantics: 24 h from last inbound; only templates exempt;
  reactions gated; `131047` → `WindowClosedError`; `131026` →
  `UndeliverableError` (code, not docs — see F18).
- Rate-limit constants: pair 1 msg / 6 s and 80 MPS default match
  Meta's overview page.
- Media ceilings: image 5 MB, audio/video 16 MB, document 100 MB,
  sticker 100 KB / 500 KB.
- Auth template OTP ≤ 15 chars, OTP duplicated into body + URL
  button; carousel ≤ 10 cards; list ≤ 10 sections and ≤ 10 rows
  total; buttons 1–3.
- Typing indicator wire shape `typing_indicator: { type: "text" }`
  coupled to `status: "read"`.
- Media download: two-step `GET /{media-id}` → bearer fetch of the
  5-minute URL; URL is never cached.
- Dedupe TTL 24 h; Redis `SET PX NX` and Postgres
  `ON CONFLICT … WHERE expires_at <= now()` are both atomic.
- Storage table name is regex-validated before interpolation
  (`postgres.ts:55`) — no SQL-injection path.
- `TokenProvider` resolved exactly once per logical request;
  provider failures → `AuthenticationError` before HTTP.
- v26.0 has no WhatsApp Cloud API breaking changes affecting this
  surface; v25.0 remains supported until Jul 29, 2028.

---

## 5. Recommended remediation order

Each item is one OpenSpec change (per `AGENTS.md`). Suggested
grouping:

1. **`redact-span-path-credentials`** — F1. Smallest diff, highest
   consequence. Ship as a patch release.
2. **`realign-meta-error-taxonomy`** — F2, F5, F7, F8 (codes), F9,
   F10, F18. One `cloud-api-client` spec delta; updates
   `mapMetaError`, `isRetryableError`, `extractMetaCode`, the
   compliance table, and `errors.test.ts`. Breaking for anyone
   matching `131053` as `RateLimitError` → minor bump.
3. **`fix-template-preflight-validation`** — F3, F15, F16.
   `template-management` spec delta.
4. **`window-tracker-honour-inbound-timestamp`** — F4 (+ F21 bridge
   call site). `window-tracker` spec delta.
5. **`retry-respect-caller-abort`** — F6.
6. **`webhook-user-preferences-and-flows`** — F8 (webhook), F11.
   `webhook-receiver` spec delta + fixtures.
7. **`media-transport-parity`** — F12, F13, F14.
8. Doc-only (no OpenSpec): F17 (types.ts header, AGENTS count),
   F19, F20, F22, F24.
9. **`bump-graph-api-version`** to v26.0 — F17. Use the archived
   change as template; update the "~17 sites" figure.
10. Roadmap: F23, F25.

Before any of the above: commit or stash the agent-bridge WIP after
`pnpm format` so the gate is green on `main` (F21).

---

## 6. Probe reproductions

All probes were msw-backed vitest files placed temporarily under
`packages/whatsapp-sdk/test/` and removed after the run. Minimal
forms for re-verification:

```ts
// P1 — token in span
await client.healthCheck({ retryPolicy: NO_RETRY });
exporter.getFinishedSpans()[0].attributes["whatsapp.path"];
// "/debug_token?input_token=<TOKEN>"

// P2 — exhausted 503
server.use(http.post(URL, () => HttpResponse.text("x", { status: 503 })));
await client.sendText({ to, body }).catch((e) => e.constructor.name);
// "TransientHttpError"

// P3 — pre-aborted signal
const ac = new AbortController(); ac.abort();
await client.sendText(input, { signal: ac.signal, retryHooks: { onRetry: () => n++ } }).catch(() => {});
// n === 3

// P4 — media header
buildTemplate({ ..., components: [{ type: "header", parameters: [{ type: "image", image: { link } }] }],
  validateAgainst: { components: [{ type: "HEADER", format: "IMAGE" }, ...] } });
// TemplateError: header expects 0 parameter(s) but payload provided 1

// P6 — late inbound
await tracker.notifyInbound(wa, Date.now() - 30 * 3600_000);
await tracker.isWindowOpen(wa); // true

// P10 — error taxonomy
mapMetaError(400, { error: { code: 131053, message: "" } }).constructor.name; // RateLimitError
mapMetaError(400, { error: { code: 80007, message: "" } }).code;            // "UNKNOWN"
mapMetaError(400, { error: { code: 131050, message: "" } }).code;           // "UNKNOWN"

// Q2 — fetchBytes emits no span
exporter.reset(); await media.fetchBytes(); exporter.getFinishedSpans().length; // 0

// Q4 — parity
await mock.uploadMedia({ file: new Uint8Array(6 * 2 ** 20), mimeType: "image/jpeg" }); // { id }
await real.uploadMedia(sameInput); // throws WhatsAppError (5 MB ceiling)

// Q6 — dedupe before handler
receiver.on("message", () => { attempts++; throw new Error(); });
await receiver._dispatchEvents([ev]); await receiver._dispatchEvents([ev]); // attempts === 1
```
