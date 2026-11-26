# Compliance & policy

This repository enforces a subset of Meta's WhatsApp Cloud API
rules in code, and relies on the consumer to enforce the rest.
This page is the audit trail: what each package promises, what
you must do, and where we currently diverge from the most-recent
Meta guidance.

**Scope between the two packages:** the SDK
(`@dojocoding/whatsapp-sdk`) does the actual enforcement. The
MCP server (`@dojocoding/whatsapp-mcp`) wraps the SDK's outbound
surface but does **not** add new policy on top — it inherits
whatever the SDK enforces (HMAC verification, 24-hour window
gating, template approval, etc.). Consumer-side policy (e.g.
opt-in / opt-out consent for marketing templates) is your
responsibility on either path; see
[`cookbook/hybrid/compliance-broadcast.md`](./cookbook/hybrid/compliance-broadcast.md)
for the recommended consent-gating pattern (it works against
both packages via a `WhatsAppLikeClient` wrapper).

The canonical "domain rules" block lives in
`openspec/config.yaml` (the "Domain rules — never violate"
section). Treat that as the source of truth; this page makes
the rules navigable.

The MCP server adds **two of its own invariants** (covered by
`openspec/specs/mcp-server/spec.md`):

- **Credentials never accepted as tool-call arguments.** No
  tool's `inputSchema` declares an `accessToken`,
  `phoneNumberId`, `appSecret`, or `businessAccountId` field.
- **`AuthenticationError` messages are redacted** when surfaced
  to the LLM, to prevent the SDK's raw error text (which may
  carry the token) from landing in the MCP transcript.

## 1. Rules this SDK enforces in code

| Rule                                                                                                               | Where it's enforced                                                                                                                                                                              | Notes                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capture **raw bytes** before any JSON parser. HMAC is computed over what Meta sent.                                | `packages/whatsapp-sdk/src/adapters/express/index.ts` (`express.raw({ type: "application/json" })`); `packages/whatsapp-sdk/src/webhooks/signature.ts` accepts `Buffer \| Uint8Array \| string`. | Re-serialising a parsed JSON body breaks signature verification.                                                                                 |
| HMAC compare is **timing-safe** (`crypto.timingSafeEqual`).                                                        | `packages/whatsapp-sdk/src/webhooks/signature.ts:46`.                                                                                                                                            | Length / hex-shape mismatches short-circuit safely without leaking which check failed.                                                           |
| Webhook ack to Meta must be **200 within 30 s**. Handlers run async.                                               | `packages/whatsapp-sdk/src/adapters/express/index.ts:82` — `res.status(200).end()` runs before `dispatchPromise.catch(...)`.                                                                     | A slow handler will not delay the ack.                                                                                                           |
| **Dedupe by `wamid`.** Meta retries failed webhook deliveries with backoff.                                        | `packages/whatsapp-sdk/src/webhooks/receiver.ts:198` (`makeDedupeKey`); `packages/whatsapp-sdk/src/webhooks/dedupe.ts`.                                                                          | Per-event keys: `msg:<wamid>` for messages, `status:<wamid>:<status>` for statuses (so `sent → delivered → read` transitions are not collapsed). |
| **24-hour customer-service window.** Outside it, only approved templates may be sent (Meta returns code `131047`). | `packages/whatsapp-sdk/src/window/tracker.ts`; `WhatsAppClient` pre-flight check in `packages/whatsapp-sdk/src/client/whatsapp-client.ts`.                                                       | Only approved templates are exempt. Reactions and every free-form type are gated.                                                                |
| Template variables `{{1}}`, `{{2}}`, … are **1-indexed and contiguous**.                                           | `packages/whatsapp-sdk/src/templates/placeholders.ts:28` rejects `{{0}}`; `:35-41` rejects gaps.                                                                                                 | The 1-indexed convention is a recurring off-by-one source.                                                                                       |
| `waba_id` (templates, account-level events) ≠ `phone_number_id` (sends, message events).                           | Distinct fields on `WhatsAppClientOptions`; webhook events carry both.                                                                                                                           | The two are not interchangeable.                                                                                                                 |
| Every outbound payload sets `messaging_product: "whatsapp"` and `recipient_type: "individual"`.                    | `BASE_PAYLOAD` in `packages/whatsapp-sdk/src/messages/builders.ts:28`.                                                                                                                           | Builders concatenate this constant — you cannot accidentally omit it.                                                                            |
| **Pinned Graph API version.** Constructor-overridable.                                                             | `packages/whatsapp-sdk/src/types/constants.ts:1` exports `GRAPH_API_VERSION = "v26.0"`; `WhatsAppClientOptions.graphApiVersion?: GraphApiVersion` overrides per-instance.                        | Bumped to v26.0 in OpenSpec change `bump-graph-api-version-v26`.                                                                                 |
| Errors **never carry credential values.**                                                                          | `packages/whatsapp-sdk/src/types/errors.ts:32-62` (`MissingCredentialsError`); unit-tested.                                                                                                      | `JSON.stringify(err)` is safe to log.                                                                                                            |
| **Zero global state.** One client / receiver per WABA-phone pair.                                                  | No module-level singletons; everything is constructor-injected.                                                                                                                                  | Multi-WABA / multi-tenant by construction.                                                                                                       |
| Every Graph call and webhook handler invocation gets an **OTel span**.                                             | `withSpan("whatsapp.request", …)` in `packages/whatsapp-sdk/src/client/transport.ts:69`; `withSpan("whatsapp.webhook.dispatch", …)` in `packages/whatsapp-sdk/src/webhooks/receiver.ts:161`.     | No-op when no tracer is registered.                                                                                                              |
| **PII redaction on spans.** `phone_number_id` is hashed.                                                           | `packages/whatsapp-sdk/src/observability/redact.ts`; salt configurable via `setRedactSalt`.                                                                                                      | Default salt is shared across processes — set per-environment in production.                                                                     |
| Mock mode satisfies the same public interface as the real client and is **parity-tested**.                         | `WhatsAppLikeClient` interface at `packages/whatsapp-sdk/src/mock/types.ts:25`; `test/parity/`.                                                                                                  | `WHATSAPP_MODE=mock` switches via `pickWhatsAppClient`.                                                                                          |

## 2. Rules the consumer must enforce

The SDK can't see the inside of your application. These are your job:

1. **Wire `tracker.notifyInbound(e.from, e.timestamp)` from a `message` handler.**
   Otherwise the window tracker stays empty and every free-form send
   throws `WindowClosedError`. See [`window.md`](./sdk/window.md).
   ```ts
   receiver.on("message", (e) => tracker.notifyInbound(e.from, e.timestamp));
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
8. **Use a shared `Storage` backend for multi-process deployments.**
   `InMemoryStorage` is per-process; two Node workers each have
   their own map and silently break webhook dedupe + window-tracker
   correctness. Use [`createRedisStorage`](./sdk/storage.md) or
   [`createPostgresStorage`](./sdk/storage.md) whenever more than one
   process touches the same WABA.
9. **Budget for per-message pricing (live since Oct 1, 2026).**
   Since **Oct 1, 2026** Meta charges service (free-form) messages
   per message, with **1,000 free service messages per business
   phone number per month** ("Service messages beyond 1,000 free per
   business phone number per month are charged" — Meta pricing page),
   and charges `UTILITY` templates sent inside an open customer-service
   window. Government and non-profit businesses are exempt through
   Dec 31, 2027. Meta's non-template-messages page does not mention
   the 1,000 free tier; treat the pricing page as authoritative and
   check your invoice. WABAs without a payment method on file by
   Sep 30, 2026 had service messages stopped; sends from such an
   account now fail with Meta code `131042`, which the SDK maps to
   `AccountRestrictedError`. What this means for an LLM orchestrator:
   - Past the free tier, every agent turn is a billable message.
     Batch what you can into one send; don't emit "typing…" or "one
     moment" filler as separate messages (use
     `markAsRead({ messageId, typing: true })` instead — read receipts
     and typing indicators are free).
   - Reconcile invoices against `StatusEvent.pricingType`
     (`regular` | `free_customer_service` | `free_group_customer_service`
     | …; keep the string open) and `StatusEvent.billable`. Meta also
     sends a `pricing.subtype` (`free_tier` / `paid_exempt`) on service
     messages; the SDK does not surface it yet.
     `conversationId` is usually absent under per-message pricing.
   - The Click-to-WhatsApp free entry-point window is still described
     on Meta's non-template page but no longer listed on the pricing
     page. Detect it from `MessageEvent.referral` if you rely on it;
     the SDK does not track it.
10. **Wire `user_preferences` to your `OptInRegistry`.** Meta's native
    marketing opt-out webhook is authoritative; the SDK's inbound
    keyword detection is only a fallback. See
    [`opt-in.md`](./sdk/opt-in.md).
11. **Handler retries are yours.** The receiver dedupes a wamid
    _before_ dispatch, so a throwing handler is never re-run by Meta's
    redelivery. Push work onto your own durable queue if you need
    at-least-once processing. See
    [`webhooks.md`](./sdk/webhooks.md#dedupe-happens-before-dispatch--a-throwing-handler-is-not-retried).

## 3. Resolved findings (changelog)

Each item below was previously flagged as a divergence from Meta's
guidance. The finding has since been addressed via an OpenSpec change.

### 3.1 Graph API version pin — bumped `v23.0` → `v25.0` → `v26.0` ✓

- **Finding (May 2026):** SDK was pinned at `v23.0` while Meta's current
  was `v25.0`. **Finding (Sep 2026, audit F17):** pinned at `v25.0`
  after Meta shipped `v26.0` on 2026-07-29.
- **Resolution:** OpenSpec changes `bump-graph-api-version` and
  `bump-graph-api-version-v26`. The constant in
  `packages/whatsapp-sdk/src/types/constants.ts:1` is now `"v26.0"`. The
  constructor's `graphApiVersion?: GraphApiVersion` override is
  unchanged — consumers who need an older version for migration testing
  pass it explicitly. `v26.0` carries no WhatsApp Cloud API breaking
  changes.
- **Re-evaluation cadence:** on each Meta version release (roughly
  every 5–6 months) or when Meta announces sunset for the pinned
  version (~24 months after the next-version release).

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
  `packages/whatsapp-sdk/src/client/errors.ts` routes the codes above to the right class
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
- **Coverage (Nov 2026):** template-paused (`132015`), throughput
  (`130429`, `131056`, `4`, `80007`), recipient-blocked (`130403`),
  billing (`131042`), phone-number configuration (`33`, `131037`,
  `131045`, `133010`) and Meta's "temporary" codes are all typed now
  (OpenSpec change `realign-error-taxonomy-2026q4`). See § 4 for the
  full table. Codes only the Marketing Messages API returns (`131055`,
  `134100`, `134101`) still fall through to `UNKNOWN`, because the SDK
  has no Marketing Messages endpoint.

### 3.4 `X-Dojo-Idempotency-Key` → `X-Request-Id` rename (sdk-v0.9.0)

- **Finding:** The header was named `X-Dojo-Idempotency-Key` but Meta
  did not consult it for deduplication. The "idempotency" naming
  created a false-positive feeling — consumers reading the JSDoc
  assumed their retry loop was safe; it wasn't.
- **Resolution:** Renamed the header to `X-Request-Id` (industry-
  standard request correlation), the OTel span attribute to
  `whatsapp.request.id`, and `RequestOptions.idempotencyKey` to
  `RequestOptions.requestId`. No behavioural change — the same UUID
  is still generated per call and reused across retry attempts; only
  the naming is honest now.
- **Real outbound deduplication** is on the v2 roadmap (the
  `outbound-deduper` capability — a `Storage`-backed cache keyed on
  `(phoneNumberId, recipient, payloadHash, ttl)`). Not in scope for
  v1.0.0.
- **Migration:** mechanical rename per consumer. See
  [`MIGRATION.md`](../MIGRATION.md) § "SDK: 0.8.x → 1.0.0".

### 3.5 `MockWhatsAppClient` template parity — registry now seedable ✓

- **Finding:** Mock `listTemplates()` always returned `{ data: [] }` and
  `getTemplate(id)` always rejected. Tests had to stub via `vi.spyOn`
  to set up `validateAgainst` flows.
- **Resolution:** OpenSpec change `add-mock-template-registry` adds an
  optional `templates: ReadonlyArray<TemplateDefinition>` seed to
  `MockWhatsAppClientOptions`. When provided, `listTemplates(query?)`
  filters in-memory and `getTemplate(id)` resolves with the matching
  entry. With no seed, behaviour matches v1 exactly — existing parity
  tests are unaffected. See [`mock.md`](./sdk/mock.md#template-registry).

## 4. Error-code coverage

Mapping of which Meta error code becomes which typed `WhatsAppError`
subclass (see `packages/whatsapp-sdk/src/client/errors.ts`):

Source of truth for the codes: Meta's
[WhatsApp error-code reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes).
Every error that leaves a `WhatsAppClient` method is a
`WhatsAppError` — retry-loop markers, `fetch` failures and
cancellations are wrapped before they reach you.

| Meta code(s)                                                                                                                                                           | Typed class                                             | Discriminator        | Retried by SDK?                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| `4` (app-level throughput), `80007` (WABA-level, e.g. template reads)                                                                                                  | `RateLimitError`                                        | `RATE_LIMIT`         | Yes                                                     |
| `130429` (Cloud API throughput), `131056` (pair limit)                                                                                                                 | `RateLimitError`                                        | `RATE_LIMIT`         | Yes                                                     |
| `131048` (spam rate limit — sending restricted; check quality in WhatsApp Manager)                                                                                     | `RateLimitError`                                        | `RATE_LIMIT`         | **No** — quality restriction, retries add flagged sends |
| `131049` / `131066` (not delivered for ecosystem health / template quality or max price), `131064` (classification enforcement), `133016`                              | `RateLimitError`                                        | `RATE_LIMIT`         | **No** — window is hours/days                           |
| HTTP `429` with no Meta envelope                                                                                                                                       | `RateLimitError` (`metaCode` undefined)                 | `RATE_LIMIT`         | Yes, then surfaced                                      |
| `1`, `2`, `131000`, `131016`, `131057`, `133004`, `2494100` (temporary / maintenance — "try again")                                                                    | `TransientError` (`metaCode`, `httpStatus`, `attempts`) | `TRANSIENT`          | Yes, then surfaced — may have been delivered            |
| `131047` (re-engagement — 24-hour window closed)                                                                                                                       | `WindowClosedError`                                     | `WINDOW_CLOSED`      | No — send a template                                    |
| `131026` (message undeliverable — not on WhatsApp / outdated client / ToS)                                                                                             | `UndeliverableError` (`reason: "UNREACHABLE"`)          | `UNDELIVERABLE`      | No — a template will NOT help                           |
| `130403` (this business has blocked the user)                                                                                                                          | `UndeliverableError` (`reason: "RECIPIENT_BLOCKED"`)    | `UNDELIVERABLE`      | No — unblock the user first                             |
| `131050` (recipient stopped marketing messages)                                                                                                                        | `OptOutError` (`metaCode: 131050`)                      | `OPT_OUT`            | No — record in `OptInRegistry`                          |
| `368`, `130497`, `131031` (integrity — blocked / restricted / locked)                                                                                                  | `AccountRestrictedError`                                | `ACCOUNT_RESTRICTED` | No — halt the campaign                                  |
| `131042` (payment method), `33` (number deleted), `131037` (555 number without approved display name), `131045` (registration error), `133010` (number not registered) | `AccountRestrictedError`                                | `ACCOUNT_RESTRICTED` | No — operator fixes billing / number setup              |
| `132000`–`132999` (template errors), `134102` (template unavailable, returned on HTTP 500); `metaCode` preserved                                                       | `TemplateError`                                         | `TEMPLATE`           | No                                                      |
| `0`, `190` (invalid / expired / revoked token; `190` carries `subcode`), `200` (no access token provided)                                                              | `AuthenticationError`                                   | `AUTHENTICATION`     | No                                                      |
| `3`, `10`, `131005`, `201`–`299` (permission not granted or removed)                                                                                                   | `PermissionError`                                       | `PERMISSION`         | No                                                      |
| `100`, `131008`, `131009`, `131051`, `131052`, `131053` (request shape / content)                                                                                      | `CapabilityError`                                       | `CAPABILITY`         | No — fix the request                                    |
| `131021` (sender = recipient), `131063` (marketing templates disabled on Cloud API), `131065` (max-price delivery unavailable in that country)                         | `CapabilityError`                                       | `CAPABILITY`         | No — change the request or endpoint                     |
| Anything else with a Meta envelope                                                                                                                                     | `WhatsAppError("UNKNOWN", …)`                           | `UNKNOWN`            | No (Yes on HTTP 408 / 5xx, then `TransientError`)       |
| HTTP `408` / `5xx` without a typed non-retryable Meta code, persisting through the retry budget                                                                        | `TransientError` (`httpStatus`, `attempts`)             | `TRANSIENT`          | Yes, then surfaced                                      |
| `fetch` failed (DNS / TCP / TLS) through the retry budget                                                                                                              | `NetworkError` (`cause` = the `TypeError`)              | `NETWORK`            | Yes, then surfaced                                      |
| Caller's `AbortSignal` fired                                                                                                                                           | `RequestAbortedError` (`cause` = `AbortError`)          | `ABORTED`            | No                                                      |
| `2xx` whose body is not JSON                                                                                                                                           | `WhatsAppError("UNKNOWN", …, { cause })`                | `UNKNOWN`            | No — may have been delivered                            |
| Media CDN `401` / `403` / `404` / `410` on `fetchBytes()` / `fetchMediaUrl()`                                                                                          | `MediaExpiredError` (`httpStatus`, `mediaId`)           | `MEDIA_EXPIRED`      | No — re-run `downloadMedia()`                           |

**The envelope wins over the HTTP status.** Meta sends some permanent
codes on HTTP 5xx (`134102` arrives as HTTP 500) and quality throttles
on HTTP 429. The transport reads the body first. If it carries a Meta
code that maps to a non-retryable typed class, that error is thrown on
the first attempt and the request is not retried. Only unmapped codes
and the retryable families keep the 408 / 429 / 5xx retry behaviour.

`131053` is a **permanent** media error ("unable to upload the media
used in the message", e.g. unsupported MIME type) — it was
misclassified as a throttle before `sdk-v0.10.0`.

**Recommended catch pattern:**

```ts
try {
  await client.sendText({ to, body });
} catch (err) {
  if (err instanceof WindowClosedError) {
    // fall back to an approved template
  } else if (err instanceof UndeliverableError) {
    // recipient unreachable — a template will not help; use another channel
  } else if (err instanceof OptOutError) {
    // authoritative when err.metaCode === 131050 — record it, never retry
  } else if (err instanceof RateLimitError) {
    // already retried per the policy when retryable; queue for later
    // (131048 / 131049 / 131066 / 131064: wait hours, not seconds)
  } else if (err instanceof AccountRestrictedError) {
    // WABA-level enforcement — stop the campaign, page an operator
  } else if (err instanceof AuthenticationError) {
    // token expired / revoked / invalid — rotate via Business Manager
  } else if (err instanceof PermissionError) {
    // surface to ops; usually a Business Manager scope issue
  } else if (err instanceof CapabilityError) {
    // request-shape / content bug — fix the call site, not retry
  } else if (err instanceof TemplateError) {
    // template-side problem — err.metaCode tells you which (132001 missing, 132015 paused, …)
  } else if (err instanceof TransientError) {
    // Meta 5xx or a "temporary" code (err.metaCode) persisted — the send MAY
    // have gone through; reconcile before re-sending
  } else if (err instanceof NetworkError) {
    // never reached Meta — safe to retry once connectivity is back
  } else if (err instanceof RequestAbortedError) {
    // your own AbortSignal fired
  } else if (err instanceof WhatsAppError) {
    // err.code === "UNKNOWN"; surface err.message
    log.error("whatsapp send failed", { code: err.code, message: err.message });
  } else {
    throw err; // not from this SDK — let it propagate
  }
}
```

## 4.1 Known upcoming platform changes

Dated changes from Meta's official pages that will affect SDK
consumers. None of them break the SDK today.

- **March 2027 — `131066` replaces `131049`** for messages not
  delivered because of template quality or max price (Marketing
  Messages changelog, Nov 20, 2026). The SDK already maps both codes
  to a non-retryable `RateLimitError`.
- **Apr 13, 2027 — no marketing on Cloud API for new Messaging
  accounts.** Messaging accounts created on or after this date cannot
  send marketing messages through Cloud API.
- **Oct 13, 2027 — Cloud API marketing sunset.** "Cloud API will stop
  supporting marketing messages on October 13, 2027 … sending
  marketing messages on Cloud API will produce an error." The SDK
  sends every template category to `/{phone-number-id}/messages` and
  has no Marketing Messages API endpoint. Plan to move `MARKETING`
  sends to the Marketing Messages API before then. `131063`
  (marketing templates disabled on Cloud API) maps to
  `CapabilityError` today.
- **Dec 31, 2026 — migrate off `paid_messaging_account_id`**
  (account-model evolution). The SDK does not send this field.
- **H1 2027 / H1 2028 — `messaging_account_id` becomes required.**
  It is required for tokens that span several Messaging accounts on
  the newest Messages API version in H1 2027, and on all versions in
  H1 2028. Existing WABA IDs are Messaging-account IDs, so
  `wabaId` == Messaging account ID. The SDK has no
  `messagingAccountId` option yet.
- **Graph API versions:** `v26.0` (the SDK pin) is still the latest;
  `v23.0` expires Oct 8, 2027, `v24.0` Feb 18, 2028, `v25.0` Jul 29, 2028.

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
- MCP tooling inside the SDK package — the MCP server ships separately
  as `@dojocoding/whatsapp-mcp` in this repository
  (`dojo-conversation-state-mcp`)
