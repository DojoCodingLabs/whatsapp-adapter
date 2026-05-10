# AGENTS.md

> Operating context for AI agents working in this repository. Read this
> file fully before any code change or before generating consumer code
> that imports `@dojocoding/whatsapp`.

## What this repository is

`@dojocoding/whatsapp` — a typed TypeScript SDK that wraps Meta's
WhatsApp Cloud API (Graph API) for the Dojo Coding agentic front-desk
platform. **Not** a WhatsApp Web client (don't confuse with `Baileys`,
`whatsapp-web.js`, `wacli`, or anything `whatsmeow`-based — different
trust model entirely).

Spec-driven via OpenSpec (`openspec/`); the spec is the source of
truth, not the code. Status: pre-alpha; public API stable enough for
internal consumers, breaking changes can land between archives.

## Authoritative sources (in order)

When in doubt, read these — and trust them in this order:

1. **`openspec/config.yaml`** § "Domain rules — never violate" — the
   contract every requirement must satisfy.
2. **`openspec/specs/<capability>/spec.md`** — per-capability
   requirements + scenarios. Eight specs: `cloud-api-client`,
   `message-builders`, `webhook-receiver`, `window-tracker`,
   `template-management`, `mock-mode`, `observability`,
   `framework-adapters`.
3. **`docs/compliance.md`** — what the SDK enforces, what the consumer
   must enforce, error-code coverage table.
4. **JSDoc on public exports** in `src/**/*.ts`.
5. **README.md / docs/architecture.md** for orientation; never as the
   final word.

## Hard rules (never violate)

These come straight from `openspec/config.yaml`. If you're about to
generate code that breaks any of them, **stop**.

- **Webhook bodies: capture RAW bytes BEFORE any JSON parser.** HMAC
  is over the bytes Meta sent; re-serialised JSON breaks verification.
- **HMAC compare must be timing-safe** (`crypto.timingSafeEqual`).
- **Webhook ack to Meta MUST be 200 within 30 s; handlers run async.**
  Never `await dispatchPromise` inside the HTTP handler.
- **Meta retries failed webhook deliveries with backoff for up to 7
  days.** Dedupe by `wamid`; receiver is the source of truth.
- **24-hour customer-service window:** outside it, only approved
  templates flow. Free-form sends must throw before HTTP.
- **Template variables `{{N}}` are 1-INDEXED** and contiguous. Off-by-one
  is the #1 source of regressions.
- **`waba_id` ≠ `phone_number_id`.** Never conflate.
- **Pin Graph API version** (currently `v25.0`); per-instance override
  via `WhatsAppClientOptions.graphApiVersion`.
- **Media download URLs from Meta expire ~5 min.** Never cache.
- **One library instance per WABA-phone pair.** Multi-WABA = multiple
  instances. **Zero global state.**
- **Every external API call and every webhook handler invocation gets
  an OTel span.** PII redacted (`hashPhoneNumberId`).
- **Mock mode satisfies the same public interface as real** and is
  parity-tested.
- **Errors are typed classes extending `WhatsAppError`.** No throwing
  strings. No `any` in error payloads.
- **Errors never carry credential values.** `MissingCredentialsError`
  names the field, never the value.
- **Never silently catch and swallow errors.** Surface or wrap with
  context.

## Decision rules

When generating consumer code, choose between options using these
rules. They're written for both humans and agents.

### Sending a message

```
need to send a message?
├─ window OPEN for `to`?
│  ├─ yes → use `client.sendText` / `sendImage` / etc. (free-form)
│  └─ no  → use `client.sendTemplate` (window-exempt)
├─ replying to a wamid → add `replyTo: <wamid>` to any builder, or use `client.sendReply`
├─ reacting to a wamid → use `client.sendReaction` (window-exempt)
└─ have a pre-built `WhatsAppMessage` payload?
   └─ use `sendMessage(client, payload)` directly
```

### Receiving events

```
need to handle a webhook event?
├─ `messages` field?
│  ├─ inbound message → `receiver.on("message", h)`
│  └─ delivery status → `receiver.on("status", h)`
├─ template lifecycle → `template_status` / `template_quality` / `template_category`
├─ phone-number quality → `phone_number_quality`
├─ account-level → `account_alert` / `account_review`
├─ unknown field (forward-compat) → `receiver.on("unknown", h)` to log
└─ handler exception → `receiver.on("error", h)` (handler errors don't break the ack)
```

### Mock vs real client

- Tests / CI / local dev → `pickWhatsAppClient({...})` with
  `WHATSAPP_MODE=mock`.
- Tests that need a specific `TemplateDefinition` → seed
  `MockWhatsAppClientOptions.templates` (preferred over `vi.spyOn`).
- Code that wants to take either backend → type-annotate against
  `WhatsAppLikeClient`.

### Catching errors from a send

Order matters — most-specific first:

```ts
try {
  await client.sendText({ to, body });
} catch (err) {
  if (err instanceof WindowClosedError) /* fall back to template */ ;
  else if (err instanceof RateLimitError) /* already retried; queue */ ;
  else if (err instanceof AuthenticationError) /* rotate token */ ;
  else if (err instanceof PermissionError) /* surface to ops */ ;
  else if (err instanceof CapabilityError) /* request-shape bug */ ;
  else if (err instanceof TemplateError) /* template definition / params */ ;
  else if (err instanceof WhatsAppError) /* err.code === "UNKNOWN" */ ;
  else throw err; // not from this SDK
}
```

## How to work in this repo

```bash
pnpm install                 # install deps
pnpm typecheck               # tsc --noEmit
pnpm lint                    # eslint .
pnpm format:check            # prettier --check
pnpm test                    # vitest run
pnpm test:coverage           # with line ≥ 90%, branch ≥ 85%
pnpm build                   # tsup → dist/ (ESM + CJS + .d.ts)
openspec validate --strict   # validates active changes + stable specs
```

CI runs all of the above on every PR. Pre-commit hooks
(`simple-git-hooks`) run `lint-staged` and `pnpm typecheck` locally.

### Adding behaviour to the SDK

1. **Always start with an OpenSpec change proposal.** Don't write
   code first. Don't update stable specs first.
   ```
   openspec new change <kebab-case-name>
   ```
2. Write the proposal (`proposal.md`), design (`design.md`),
   tasks (`tasks.md`), and spec deltas
   (`specs/<capability>/spec.md`).
3. Run `openspec validate <name> --strict`. Iterate until clean.
4. Implement against the proposal, ticking tasks as you go.
5. Add tests at the right layer (see "Test layers" below).
6. `openspec archive <name>` merges spec deltas into stable specs.

### Test layers — pick the right one

| What you're testing                                 | Layer       | Path                                       |
| --------------------------------------------------- | ----------- | ------------------------------------------ |
| Pure module behaviour (one function / class)        | unit        | `test/unit/<capability>/`                  |
| Public API surface against spec scenarios           | contract    | `test/contract/<capability>/` (msw-backed) |
| Framework-adapter end-to-end (Express + supertest)  | integration | `test/integration/<framework>/`            |
| `MockWhatsAppClient` ⇄ `WhatsAppClient` equivalence | parity      | `test/parity/`                             |
| Real Meta sandbox calls                             | E2E (gated) | only runs when `WHATSAPP_E2E=1`            |

**Every public-API change** pairs with at least one test. **Every new
error class** has at least one negative-path test.

### File-path conventions

- Public exports go through `src/index.ts` (root) or
  `src/adapters/<framework>/index.ts` (sub-modules).
- New capability code lives in `src/<capability>/<file>.ts`. Each
  capability has its own `index.ts` that re-exports.
- Internal helpers live next to their consumer; never invent a
  `src/lib/` or `src/utils/`.
- Constants (Graph version, TTLs) live in `src/types/constants.ts`.

## What you must not do

Specific anti-patterns we have debugged before:

- **Don't `await dispatchPromise` inside the Express webhook
  handler.** That blows the 30s ack and Meta starts retrying for up to
  7 days. The middleware acks 200 first; handlers run on the returned
  promise.
- **Don't register `express.json()` before
  `createWhatsAppMiddleware`.** A global JSON parser consumes the
  stream; the raw-body capture in the WhatsApp middleware then sees an
  empty buffer; HMAC fails; you get 401s.
- **Don't cache Meta's media-download URLs.** They expire ~5 minutes
  after issue. Download-and-store; don't reuse the URL.
- **Don't pin to a Meta error code's exact `metaCode` when a typed
  class exists.** Use `instanceof RateLimitError`, not
  `err.metaCode === 131056`. Codes within a class can change; the class
  is stable.
- **Don't add `any`** in production code. Strict TS is on
  (`noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`).
- **Don't introduce module-level singletons.** Multi-WABA tenancy
  requires zero global state. Constructor-inject everything.
- **Don't catch and swallow.** Re-throw, wrap with context, or
  surface via `onError`. Silent catches are a debugging black hole.
- **Don't bypass `windowTracker.notifyInbound`** when handling a
  `message` event in production — every free-form send will throw
  `WindowClosedError`. Wire it as the first thing your handler does.
- **Don't trust `event.body` as a typed shape.** It's
  `Record<string, unknown>` deliberately; narrow per `event.type`.
- **Don't re-implement the retry policy.** Use `DEFAULT_RETRY_POLICY`
  or pass a `RequestOptions.retryPolicy` per call.
- **Don't generate template names with placeholders Meta hasn't
  approved.** Use `validateAgainst: definition` to catch mismatches
  pre-flight.
- **Don't bump `GRAPH_API_VERSION` without an OpenSpec change** that
  also updates the contract tests' hardcoded URLs (~17 places).

## Common tasks

### Generate a new send method

1. Add the wire-payload type to `src/messages/types.ts` (variant of
   `WhatsAppMessage`).
2. Add the builder in `src/messages/builders.ts` with input
   validation (matches existing patterns).
3. Add the convenience method on both `WhatsAppClient`
   (`src/client/whatsapp-client.ts`) and `MockWhatsAppClient`
   (`src/mock/client.ts`). Honour the window gate unless the message
   type is window-exempt (template / reaction).
4. Re-export from `src/messages/index.ts`.
5. Tests: builder unit (`test/unit/messages/`), client convenience
   contract (`test/contract/message-builders/`), parity
   (`test/parity/send-parity.test.ts`).
6. Spec scenario in `openspec/specs/message-builders/spec.md`.

### Add a new typed error class

1. Add the discriminator to `WhatsAppErrorCode` union in
   `src/types/errors.ts`.
2. Add the class extending `WhatsAppError` with `Object.setPrototypeOf`
   for cross-module `instanceof`.
3. Re-export from `src/index.ts`.
4. Update `mapMetaError` in `src/client/errors.ts` if it's mapped from
   a Meta error code.
5. Update `attachErrorAttributesToActiveSpan` in
   `src/client/transport.ts` if it carries a `metaCode` for spans.
6. Tests: hierarchy + discriminator in
   `test/unit/types/errors.test.ts`; mapper in
   `test/unit/client/errors.test.ts`.
7. Update `docs/compliance.md` § 4 error-code coverage table.

### Add support for a new webhook event kind

1. Add the event interface to `src/webhooks/events.ts` (extending
   `BaseEvent` with `kind: "..."`).
2. Add a parse branch in `src/webhooks/parser.ts#parseChange`.
3. Extend `EventKindMap` in `src/webhooks/receiver.ts` so `.on(kind, h)`
   is typed.
4. Add a fixture under `test/__fixtures__/webhooks/<kind>.json` (real
   Meta-shaped, PII redacted).
5. Tests: parser unit + receiver dispatch contract.
6. Spec scenario in `openspec/specs/webhook-receiver/spec.md`.

### Bump the pinned Graph API version

1. File OpenSpec change `bump-graph-api-version` (use the
   already-archived one as a template — it's
   `openspec/changes/archive/2026-05-10-bump-graph-api-version/`).
2. Update `src/types/constants.ts:1` and the unit assertion in
   `test/unit/types/constants.test.ts`.
3. **Bulk-update every hardcoded version URL in tests** — at time of
   writing, ~17 sites across `test/contract/` and `test/parity/`.
   `sed -i '' 's|vXX\.0|vYY.0|g' <files>` then `grep -rn vXX\.0 test/`
   to confirm zero stragglers.
4. Update spec scenarios in `openspec/specs/cloud-api-client/spec.md`
   (and the change-delta version under
   `openspec/changes/<your-change>/specs/cloud-api-client/spec.md`).
5. Update `docs/architecture.md`, `docs/mock.md`, `docs/compliance.md`.
6. `pnpm test` then `openspec archive <change>`.

## When in doubt

- **Read the spec.** `openspec/specs/<capability>/spec.md` has
  scenarios for every behaviour. They are normative.
- **Read `docs/compliance.md`.** It maps every domain rule to its
  enforcement site.
- **Look at the existing OpenSpec change archives** in
  `openspec/changes/archive/` for templates of how to write a change
  proposal.
- **Don't invent.** If a behaviour isn't in the spec, file a change
  proposal first.

## Where to look (file index)

```
src/
  client/whatsapp-client.ts   # WhatsAppClient class + send convenience methods
  client/transport.ts         # request(), buildGraphUrl, OTel span attachment
  client/retry.ts             # retry(), full-jitter backoff, parseRetryAfter
  client/errors.ts            # mapMetaError(), isRetryableHttpStatus
  client/health.ts            # healthCheck() against /debug_token
  messages/types.ts           # WhatsAppMessage discriminated union
  messages/builders.ts        # buildText / buildImage / … / buildReaction
  messages/send.ts            # sendMessage(client, payload)
  webhooks/handshake.ts       # verifyHandshake()
  webhooks/signature.ts       # verifySignature(), computeSignature()
  webhooks/parser.ts          # parseWebhookPayload()
  webhooks/dedupe.ts          # WebhookDeduper
  webhooks/events.ts          # WhatsAppEvent union
  webhooks/receiver.ts        # WebhookReceiver class
  window/tracker.ts           # WindowTracker class
  templates/api.ts            # listTemplates(), getTemplate()
  templates/placeholders.ts   # countTemplatePlaceholders()
  templates/validate.ts       # validateTemplateSend()
  mock/client.ts              # MockWhatsAppClient
  mock/factory.ts             # pickWhatsAppClient()
  observability/tracing.ts    # withSpan(), getTracer()
  observability/redact.ts     # hashPhoneNumberId(), setRedactSalt()
  storage/index.ts            # Storage interface + InMemoryStorage
  types/constants.ts          # GRAPH_API_VERSION, TTLs, etc.
  types/errors.ts             # WhatsAppError + 9 typed subclasses
docs/
  cookbook/                   # use-case-driven recipes
  patterns.md                 # composable patterns
  compliance.md               # what the SDK enforces; resolved findings
  client.md / messages.md / … # one per capability
  architecture.md             # eight-capability map
openspec/
  config.yaml                 # domain rules + conventions
  specs/<capability>/spec.md  # stable specs (eight)
  changes/                    # active change proposals (currently empty)
  changes/archive/            # archived (merged) changes
```

## Glossary

- **WABA** — WhatsApp Business Account. Top-level entity in Meta
  Business Manager. Owns one or more phone numbers.
- **`waba_id` / `phone_number_id`** — opaque Meta ids; not phone
  numbers. `waba_id` is for WABA-level ops (templates, account
  events). `phone_number_id` is for sends and message events.
- **`wa_id`** — the customer's WhatsApp id (effectively their phone
  number, no `+`). What you send `to`.
- **`wamid`** — WhatsApp message id. Returned in send responses;
  identifies messages in webhooks. Used for dedupe and replies.
- **24-hour window** — Meta's customer-service rule: outside the 24h
  after a customer's last inbound message, only approved templates
  may be sent.
- **Template categories** — `MARKETING`, `UTILITY`, `AUTHENTICATION`.
  Different rules and pricing.
- **System User / BISU** — long-lived bearer token type provisioned in
  Business Manager. The SDK takes either.
- **App Secret** — the Meta App's secret. Used for HMAC verification
  of inbound webhooks.
- **Verify token** — a string the consumer chooses, registered in
  Meta's webhook UI, used in the GET handshake.
- **OpenSpec** — the spec-driven workflow tool the project uses
  (`openspec validate`, `openspec archive`).
- **Window-exempt sends** — `sendTemplate` and `sendReaction`. Flow
  outside the 24h window by design.
