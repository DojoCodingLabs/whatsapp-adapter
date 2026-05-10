# Compliance & policy

This SDK enforces a subset of Meta's WhatsApp Cloud API rules in code, and
relies on the consumer to enforce the rest. This page is the audit trail:
what the SDK promises, what you must do, and where we currently diverge
from the most-recent Meta guidance.

The canonical "domain rules" block lives in `openspec/config.yaml` (the
"Domain rules — never violate" section). Treat that as the source of
truth; this page makes the rules navigable.

## 1. Rules this SDK enforces in code

| Rule                                                                                                               | Where it's enforced                                                                                                                                  | Notes                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capture **raw bytes** before any JSON parser. HMAC is computed over what Meta sent.                                | `src/adapters/express/index.ts` (`express.raw({ type: "application/json" })`); `src/webhooks/signature.ts` accepts `Buffer \| Uint8Array \| string`. | Re-serialising a parsed JSON body breaks signature verification.                                                                                 |
| HMAC compare is **timing-safe** (`crypto.timingSafeEqual`).                                                        | `src/webhooks/signature.ts:46`.                                                                                                                      | Length / hex-shape mismatches short-circuit safely without leaking which check failed.                                                           |
| Webhook ack to Meta must be **200 within 30 s**. Handlers run async.                                               | `src/adapters/express/index.ts:82` — `res.status(200).end()` runs before `dispatchPromise.catch(...)`.                                               | A slow handler will not delay the ack.                                                                                                           |
| **Dedupe by `wamid`.** Meta retries failed webhook deliveries with backoff.                                        | `src/webhooks/receiver.ts:198` (`makeDedupeKey`); `src/webhooks/dedupe.ts`.                                                                          | Per-event keys: `msg:<wamid>` for messages, `status:<wamid>:<status>` for statuses (so `sent → delivered → read` transitions are not collapsed). |
| **24-hour customer-service window.** Outside it, only approved templates may be sent (Meta returns code `131026`). | `src/window/tracker.ts`; `WhatsAppClient` pre-flight check in `src/client/whatsapp-client.ts:102`.                                                   | Templates and reactions are exempt — they may flow outside the window.                                                                           |
| Template variables `{{1}}`, `{{2}}`, … are **1-indexed and contiguous**.                                           | `src/templates/placeholders.ts:28` rejects `{{0}}`; `:35-41` rejects gaps.                                                                           | The 1-indexed convention is a recurring off-by-one source.                                                                                       |
| `waba_id` (templates, account-level events) ≠ `phone_number_id` (sends, message events).                           | Distinct fields on `WhatsAppClientOptions`; webhook events carry both.                                                                               | The two are not interchangeable.                                                                                                                 |
| Every outbound payload sets `messaging_product: "whatsapp"` and `recipient_type: "individual"`.                    | `BASE_PAYLOAD` in `src/messages/builders.ts:28`.                                                                                                     | Builders concatenate this constant — you cannot accidentally omit it.                                                                            |
| **Pinned Graph API version.** Constructor-overridable.                                                             | `src/types/constants.ts:1` exports `GRAPH_API_VERSION = "v25.0"`; `WhatsAppClientOptions.graphApiVersion?: GraphApiVersion` overrides per-instance.  | Bumped to v25.0 in OpenSpec change `bump-graph-api-version`.                                                                                     |
| Errors **never carry credential values.**                                                                          | `src/types/errors.ts:32-62` (`MissingCredentialsError`); unit-tested.                                                                                | `JSON.stringify(err)` is safe to log.                                                                                                            |
| **Zero global state.** One client / receiver per WABA-phone pair.                                                  | No module-level singletons; everything is constructor-injected.                                                                                      | Multi-WABA / multi-tenant by construction.                                                                                                       |
| Every Graph call and webhook handler invocation gets an **OTel span**.                                             | `withSpan("whatsapp.request", …)` in `src/client/transport.ts:69`; `withSpan("whatsapp.webhook.dispatch", …)` in `src/webhooks/receiver.ts:161`.     | No-op when no tracer is registered.                                                                                                              |
| **PII redaction on spans.** `phone_number_id` is hashed.                                                           | `src/observability/redact.ts`; salt configurable via `setRedactSalt`.                                                                                | Default salt is shared across processes — set per-environment in production.                                                                     |
| Mock mode satisfies the same public interface as the real client and is **parity-tested**.                         | `WhatsAppLikeClient` interface at `src/mock/types.ts:25`; `test/parity/`.                                                                            | `WHATSAPP_MODE=mock` switches via `pickWhatsAppClient`.                                                                                          |

## 2. Rules the consumer must enforce

The SDK can't see the inside of your application. These are your job:

1. **Wire `tracker.notifyInbound(e.from)` from a `message` handler.**
   Otherwise the window tracker stays empty and every free-form send
   throws `WindowClosedError`. See [`window.md`](./window.md).
   ```ts
   receiver.on("message", (e) => tracker.notifyInbound(e.from));
   ```
2. **Set `setRedactSalt(salt)` once at boot** to a per-environment
   value. The default salt is fine for redaction but not for cross-env
   correlation isolation.
3. **Don't register `express.json()` before `createWhatsAppMiddleware`.**
   The middleware re-captures raw bytes for HMAC, but a global JSON parser
   that already consumed the stream produces empty bodies and 401s.
4. **Don't cache Meta's media-download URLs** — they expire roughly 5
   minutes after issue. Download-and-store is your job; the SDK does not
   currently auto-refresh.
5. **Treat the verify token as a secret.** It's the only thing protecting
   the `GET /webhook` endpoint from arbitrary callers. Rotate by updating
   Meta's webhook UI and your env at the same moment.
6. **Don't log raw inbound bodies.** They contain user message text. The
   SDK's spans do not log bodies — if you do your own logging, narrow to
   the fields you actually need.
7. **One client / receiver / tracker per WABA-phone pair.** Multi-WABA
   tenancy = multiple instances. Don't share state across pairs.

## 3. Resolved findings (changelog)

Each item below was previously flagged as a divergence from Meta's
guidance. The finding has since been addressed via an OpenSpec change.

### 3.1 Graph API version pin — bumped `v23.0` → `v25.0` ✓

- **Finding:** SDK was pinned at `v23.0` while Meta's current is `v25.0`.
- **Resolution:** OpenSpec change `bump-graph-api-version`. The constant
  in `src/types/constants.ts:1` is now `"v25.0"`. The constructor's
  `graphApiVersion?: GraphApiVersion` override is unchanged — consumers
  who need an older version for migration testing pass it explicitly.
- **Re-evaluation cadence:** when a v26+ feature is required, or when
  Meta announces sunset for v25 (typically ~24 months after the
  next-version release).

### 3.2 Webhook dedupe TTL — widened 1 h → 24 h ✓

- **Finding:** `WEBHOOK_DEDUPE_TTL_MS` was 1 hour; Meta retries failed
  deliveries on backoff for up to 7 days, so re-dispatches were possible.
- **Resolution:** OpenSpec change `widen-webhook-dedupe-ttl` widened the
  default to `24 * 60 * 60 * 1000`. This absorbs the bulk of Meta's retry
  distribution (which front-loads in the first day) while keeping
  in-process memory bounded for single-instance `InMemoryStorage`
  deployments. The `dedupeTtlMs` constructor option still lets consumers
  widen further (or shorten) per-instance.
- **Multi-instance deployments** running with a shared `Storage` (Redis
  etc.) can safely pass the full `7 * 24 * 60 * 60 * 1000` to absorb
  the entire Meta retry window.

### 3.3 Typed-error surface — added auth / permission / capability classes ✓

- **Finding:** Common Meta codes (`190` auth, `200`/`210`/`230`/`294`/`299`
  permission, `100` capability) collapsed to `WhatsAppError("UNKNOWN", …)`,
  forcing consumers to parse `err.message` to branch.
- **Resolution:** OpenSpec change `expand-typed-error-classes` adds
  `AuthenticationError`, `PermissionError`, and `CapabilityError`. Each
  carries `metaCode` (and `subcode` for auth). The mapper in
  `src/client/errors.ts` routes the codes above to the right class
  before falling through to `UNKNOWN`. Span attributes (`whatsapp.error.code`
  and `whatsapp.error.meta_code`) now also flow these classes.
- **Pattern:**
  ```ts
  catch (err) {
    if (err instanceof AuthenticationError) /* rotate token */ ;
    else if (err instanceof PermissionError) /* surface to ops */ ;
    else if (err instanceof CapabilityError) /* request-shape bug */ ;
    else if (err instanceof RateLimitError)  /* already retried */ ;
    else if (err instanceof WindowClosedError) /* fall back to template */ ;
    else if (err instanceof TemplateError) /* template-side issue */ ;
    else if (err instanceof WhatsAppError) /* err.code === "UNKNOWN" */ ;
    else throw err;
  }
  ```
- **Coverage is still partial.** Recipient-blocked, template-paused, and
  throughput-exceeded codes still fall through to `UNKNOWN`. Promotions
  land as further OpenSpec changes when consumer demand is concrete.

### 3.4 `X-Dojo-Idempotency-Key` — design clarified (no code change)

- **Finding:** The header was undocumented; some readers assumed Meta
  honoured it server-side.
- **Resolution:** Documented as **client-side correlation only** in
  [`client.md`](./client.md#idempotency-hint) and the JSDoc on
  `RequestOptions.idempotencyKey`. Meta does not de-duplicate writes by
  any header; the header exists so internal logs and the future
  replay-buffering path can correlate retried writes. No code change
  was warranted.

### 3.5 `MockWhatsAppClient` template parity — registry now seedable ✓

- **Finding:** Mock `listTemplates()` always returned `{ data: [] }` and
  `getTemplate(id)` always rejected. Tests had to stub via `vi.spyOn`
  to set up `validateAgainst` flows.
- **Resolution:** OpenSpec change `add-mock-template-registry` adds an
  optional `templates: ReadonlyArray<TemplateDefinition>` seed to
  `MockWhatsAppClientOptions`. When provided, `listTemplates(query?)`
  filters in-memory and `getTemplate(id)` resolves with the matching
  entry. With no seed, behaviour matches v1 exactly — existing parity
  tests are unaffected. See [`mock.md`](./mock.md#template-registry).

## 4. Error-code coverage

Mapping of which Meta error code becomes which typed `WhatsAppError`
subclass (see `src/client/errors.ts`):

| Meta code(s)                                                         | Typed class                                                                              | Discriminator    | Retryable?         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- | ------------------ |
| `130429` (generic rate limit)                                        | `RateLimitError`                                                                         | `RATE_LIMIT`     | Yes                |
| `131048` (spam-detection rate limit)                                 | `RateLimitError`                                                                         | `RATE_LIMIT`     | Yes                |
| `131056` (per-pair rate limit)                                       | `RateLimitError`                                                                         | `RATE_LIMIT`     | Yes                |
| `131053` (media-upload throttle)                                     | `RateLimitError`                                                                         | `RATE_LIMIT`     | Yes                |
| `131026` (24-hour window closed)                                     | `WindowClosedError`                                                                      | `WINDOW_CLOSED`  | No                 |
| `132000`–`132999` (template errors)                                  | `TemplateError`                                                                          | `TEMPLATE`       | No                 |
| `190` (auth — invalid / expired / revoked token; carries `subcode`)  | `AuthenticationError`                                                                    | `AUTHENTICATION` | No                 |
| `200`, `210`, `230`, `294`, `299` (permission)                       | `PermissionError`                                                                        | `PERMISSION`     | No                 |
| `100` (capability — invalid parameter / API unknown)                 | `CapabilityError`                                                                        | `CAPABILITY`     | No                 |
| Anything else (recipient-blocked, template-paused, capacity, …)      | `WhatsAppError("UNKNOWN", …)`                                                            | `UNKNOWN`        | No                 |
| HTTP-only failures: `408`, `429`, `5xx` (no parseable Meta envelope) | `TransientHttpError` (internal) → retry; eventually `WhatsAppError` if retries exhausted | —                | Yes (status-based) |

**Recommended catch pattern:**

```ts
try {
  await client.sendText({ to, body });
} catch (err) {
  if (err instanceof WindowClosedError) {
    // fall back to an approved template
  } else if (err instanceof RateLimitError) {
    // already retried per the policy; queue for later
  } else if (err instanceof AuthenticationError) {
    // token expired / revoked / invalid — rotate via Business Manager
  } else if (err instanceof PermissionError) {
    // surface to ops; usually a Business Manager scope issue
  } else if (err instanceof CapabilityError) {
    // request-shape bug — fix the call site, not retry
  } else if (err instanceof TemplateError) {
    // template-side problem — definition / parameters
  } else if (err instanceof WhatsAppError) {
    // err.code === "UNKNOWN"; surface err.message
    log.error("whatsapp send failed", { code: err.code, message: err.message });
  } else {
    throw err; // not from this SDK — let it propagate
  }
}
```

## 5. Out of scope for v1

The following are explicitly **not** supported by the v1 SDK. Carrying them
forward as separate proposals lives in `openspec/changes/` if and when
priorities shift. From `openspec/config.yaml`:

- Voice / Calls API
- Flows beyond send-only `interactive.flow`
- Click-to-WhatsApp >72 h
- Quality dashboards (read-only access to template / phone-number quality
  is in scope via webhook events, but no aggregation surface)
- Template-authoring UI (creation lives in Meta Business Manager)
- Embedded Signup UI (consumers provision tokens; the SDK consumes them)
- The MCP wrapper — that's a separate package
  (`dojo-conversation-state-mcp`)
