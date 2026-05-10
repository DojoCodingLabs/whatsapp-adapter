# Patterns

Composable patterns for working with `@dojocoding/whatsapp`. Each is a
self-contained shape, designed to drop into any application that uses
the SDK. They're presented agent-first — terse rules + a short snippet
— but humans can read them top to bottom too.

If you're building one of the canonical use cases, start in
[`cookbook/`](./cookbook/). The patterns here are the building blocks
those recipes compose.

## Index

1. [Window-aware send (template fallback)](#1-window-aware-send-template-fallback)
2. [Idempotent handler](#2-idempotent-handler)
3. [Escalation to HITL](#3-escalation-to-hitl)
4. [Multi-tenant orchestration](#4-multi-tenant-orchestration)
5. [Token rotation on `AuthenticationError`](#5-token-rotation-on-authenticationerror)
6. [Rate-limit-aware queue](#6-rate-limit-aware-queue)
7. [Replay-safe sends with `idempotencyKey`](#7-replay-safe-sends-with-idempotencykey)
8. [Test layering](#8-test-layering)

---

## 1. Window-aware send (template fallback)

**Use when:** you want to message a customer and don't know whether the
24-hour customer-service window is still open.

**Rule:** try `sendText` (or any free-form send); on `WindowClosedError`,
fall back to a pre-approved utility template. Don't pre-flight with
`tracker.isWindowOpen` — the tracker can't see Meta's authoritative
state, only your locally-recorded `notifyInbound` calls.

```ts
import { WhatsAppClient, WindowClosedError, type TemplateDefinition } from "@dojocoding/whatsapp";

async function sendWithFallback(
  client: WhatsAppClient,
  to: string,
  body: string,
  fallbackTemplate: TemplateDefinition,
  fallbackParam: string
) {
  try {
    return await client.sendText({ to, body });
  } catch (err) {
    if (err instanceof WindowClosedError) {
      return client.sendTemplate({
        to,
        name: fallbackTemplate.name,
        language: fallbackTemplate.language,
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: fallbackParam }],
          },
        ],
        validateAgainst: fallbackTemplate,
      });
    }
    throw err;
  }
}
```

**Don't:**

- Use this pattern for marketing content. The fallback template should
  be `UTILITY` — never re-engage marketing through this path.
- Retry the free-form send after a `WindowClosedError`. The window
  isn't going to open just because you tried again; only the customer
  messaging you opens it.

---

## 2. Idempotent handler

**Use when:** your `message` or `status` handler does work that's
expensive to repeat (writes to a CRM, charges a card, sends a follow-up
message).

**Rule:** the SDK's `WebhookDeduper` already drops duplicates by
`wamid` — but only within the receiver's TTL (24h default), only on
that process / shared `Storage`. Your downstream operations should
_also_ be idempotent, keyed on `wamid`, so a misconfigured deploy or a
TTL miss can't cause a charge twice.

```ts
import { WebhookReceiver, type MessageEvent } from "@dojocoding/whatsapp";

const receiver = new WebhookReceiver({ appSecret, verifyToken });

receiver.on("message", async (e) => {
  // 1. Idempotency at YOUR layer, in addition to the SDK's dedupe.
  const result = await db.transaction(async (tx) => {
    const seen = await tx.run(
      `INSERT INTO processed_wamids (wamid, processed_at) VALUES (?, NOW())
       ON CONFLICT (wamid) DO NOTHING RETURNING wamid`,
      [e.id]
    );
    if (!seen.rows.length) return "duplicate";
    return doSideEffects(tx, e);
  });
  // 2. Reply only if this was the first sighting.
  if (result !== "duplicate") {
    await replyToCustomer(e);
  }
});
```

**Don't:**

- Trust just the SDK's in-memory deduper across multiple processes.
  Use a shared `Storage` (Redis) **and** an idempotency table at the
  app layer.
- Use `event.id` (wamid) as a primary key directly. Wamids are long
  opaque strings; use them in a `UNIQUE` index alongside your own
  surrogate id.

---

## 3. Escalation to HITL

**Use when:** the bot should stop replying and a human should pick up
the conversation through a separate inbox app — without the customer
seeing the boundary.

**Rule:** escalation is a parallel signal computed on every inbound,
not a tree branch. If the detector fires, write an "escalated" flag
into your conversation store + push a handoff packet to the inbox
queue. The bot's message handler must check the flag at the _top_ of
every turn and return early.

```ts
async function onMessage(e: MessageEvent) {
  if (await isEscalated(e.from)) return; // ← MUST be first

  const [intent, escalation] = await Promise.all([classifyIntent(e), detectEscalation(e)]);

  if (escalation.shouldEscalate) {
    await markEscalated(e.from, escalation.reason);
    await pushHandoffPacket(e, escalation.reason);
    // Optional: send a templated "a teammate will be with you shortly".
    return;
  }

  await draftAndSend(e, intent);
}
```

**Handoff packet must include** (at minimum):

- Customer `wa_id` and any `profile.name` from the event metadata
- Full conversation history from your store (ordered, timestamped)
- Escalation `reason`
- The bot's last _drafted-but-unsent_ reply, if any
- Span ids from the OTel context, so HITL actions correlate

The minimum-fields list above is enough to deliver a conversation to a
human without context loss. Richer schemas (priority, SLA timers,
Skill provenance) are application-layer concerns this SDK doesn't
prescribe.

**Don't:**

- Generate bot replies for already-escalated conversations. The HITL
  inbox writes back through the same SDK; if both write, customers
  see two voices.
- Escalate on every "unknown" intent. The bot should ask a clarifying
  question first; escalate on signals (frustration, repetition,
  explicit "agente" request, sentiment shift).

---

## 4. Multi-tenant orchestration

**Use when:** one process serves multiple WABAs (SaaS, agency, BSP,
multi-client toolkit deployment).

**Rule:** one `WhatsAppClient` + one `WebhookReceiver` + one
`WindowTracker` _per tenant_. They share a `Storage` (Redis-backed in
production) but never share their own constructor instances. The SDK
has zero global state — multi-tenancy works by construction, not
configuration. See
[`cookbook/multi-tenant.md`](./cookbook/multi-tenant.md) for the
worked example.

**Decision rules:**

- **Mount path:** prefer `/webhooks/whatsapp/:tenantId`. One mount
  per tenant; verify-token and App Secret are tenant-specific.
- **Storage keys:** `WindowTracker` already scopes by
  `phoneNumberId`. `WebhookDeduper` scopes by `wamid`. Both safely
  share a Redis instance.
- **Span attribute redact salt:** one salt **per environment**, not
  per tenant. Different tenants produce different hashes (because
  inputs differ); same-environment hashes correlate across tenants.
- **Token storage:** per tenant, in a secret manager. Watch for
  `AuthenticationError` from any send and trigger refresh for _that
  tenant only_ (see pattern 5).

**Don't:**

- Build a per-tenant `Storage` if a shared one will do — it
  multiplies infra without benefit.
- Use `entry[].id` (the `wabaId`) for tenant routing inside a single
  receiver unless you have to. Per-tenant mount paths are easier to
  debug, scale, and rotate.

---

## 5. Token rotation on `AuthenticationError`

**Use when:** a tenant's bearer token expires, is revoked, or has its
secret changed in Business Manager. The SDK throws
`AuthenticationError` (introduced in the May 2026 compliance pass).

**Rule:** detect the failure, fetch a fresh token from your secret
manager / refresh flow, swap the client _atomically_ for that tenant,
and retry the failing send once. Never retry an `AuthenticationError`
without rotating — it's not transient.

```ts
import { AuthenticationError, WhatsAppClient, type WhatsAppLikeClient } from "@dojocoding/whatsapp";

async function sendWithRotation(
  tenantId: string,
  to: string,
  body: string,
  attempts = 1
): Promise<void> {
  const client = await getClient(tenantId);
  try {
    await client.sendText({ to, body });
  } catch (err) {
    if (err instanceof AuthenticationError && attempts > 0) {
      const fresh = await refreshTenantToken(tenantId);
      replaceClient(tenantId, fresh);
      return sendWithRotation(tenantId, to, body, attempts - 1);
    }
    throw err;
  }
}
```

**Don't:**

- Retry more than once. If the second attempt also fails, the
  rotation didn't help — alert ops and stop.
- Swap the client on a `RateLimitError` or generic `WhatsAppError`.
  Token rotation only addresses `AuthenticationError`.
- Forget the `subcode` field when logging. It distinguishes
  expired (`463`) from revoked (`467`) from changed (`492`) — useful
  signal for support.

---

## 6. Rate-limit-aware queue

**Use when:** you send at scale and can't afford to drop messages on
`RateLimitError` after the SDK's retry policy exhausts.

**Rule:** the SDK already retries `RateLimitError` per
`DEFAULT_RETRY_POLICY` (4 attempts with full-jitter backoff,
honouring `Retry-After`). After the policy exhausts, the error
propagates. Catch it at the queue layer, requeue with a backoff that
takes the `metaCode` into account, and alert if the burst doesn't
clear.

| Meta code | Meaning                        | Suggested requeue delay               |
| --------- | ------------------------------ | ------------------------------------- |
| `131056`  | Per-pair rate limit            | 60s — pair-specific, clears fast      |
| `130429`  | Generic / messaging rate limit | 5min — broader bucket                 |
| `131048`  | Spam-detection rate limit      | 30min — wait and reduce burst         |
| `131053`  | Media-upload throttle          | 5min — different bucket from messages |

```ts
import { RateLimitError } from "@dojocoding/whatsapp";

async function send(job: SendJob) {
  try {
    await client.sendText(job.input);
  } catch (err) {
    if (err instanceof RateLimitError) {
      const delay = backoffFor(err.metaCode);
      await queue.requeue(job, { delayMs: delay, attempts: job.attempts + 1 });
      if (job.attempts > 5) await alert("rate-limit not clearing", err);
      return;
    }
    throw err;
  }
}

function backoffFor(metaCode: number | undefined): number {
  switch (metaCode) {
    case 131056:
      return 60_000;
    case 131048:
      return 30 * 60_000;
    case 131053:
      return 5 * 60_000;
    default:
      return 5 * 60_000;
  }
}
```

**Don't:**

- Tighten the SDK's default retry policy to "more attempts." It
  already burns up to 8 seconds of backoff before giving up; more
  attempts in-process means slower failure surfacing.
- Treat `131056` (pair rate limit) the same as `131048` (spam
  detection). Pair limits clear in seconds; spam detection is a
  trust-score signal that takes minutes to recover.

---

## 7. Replay-safe sends with `idempotencyKey`

**Use when:** the _same logical send_ might be initiated twice from
your side (a job retry, a transactional outbox replay) and you want
the SDK's logs and any client-side replay buffer to recognise the
duplicate even though Meta itself does not.

**Rule:** Meta does NOT honour the `X-Dojo-Idempotency-Key` header.
This pattern is for client-side correlation only — your logs, your
mock-mode parity replays, your future replay-buffer layer. Use it
when _you_ need to see "this is the same call as before," not because
Meta will deduplicate.

```ts
async function sendBookingConfirmation(jobId: string, to: string, body: string) {
  await client.sendText({ to, body }, { idempotencyKey: `booking-confirm:${jobId}` });
}
```

The same key is reused across the SDK's internal retry attempts
automatically. Override it explicitly only when _your_ identifier is
the right correlation key.

**Don't:**

- Treat this as protection against double-send to Meta. Two calls
  with the same idempotency key still produce two messages on the
  customer's phone. If you need at-most-once-to-Meta semantics, do
  the dedupe at _your_ layer (e.g. `processed_jobs` table) before
  calling `client.sendText`.
- Encode PII into the key. It lands in OTel span attributes
  (`whatsapp.idempotency_key`).

---

## 8. Test layering

**Use when:** you're writing tests against this SDK or against your
own code that uses it.

**Rule:** pick the lowest-cost layer that proves what you need.

| What you're testing                                              | Layer       | What to use                                                    |
| ---------------------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| Pure logic (your classifier, slot machine, queue)                | unit        | `vitest`; no SDK dependency                                    |
| Builder shape (`buildText` produces the right wire payload)      | unit        | `vitest` against `src/messages/builders.ts`                    |
| Public API surface (`client.sendText` issues the right HTTP)     | contract    | `msw` mock + `WhatsAppClient`                                  |
| Framework integration (Express middleware, ack timing, raw body) | integration | `supertest` + `createWhatsAppMiddleware`                       |
| Mock vs real client equivalence                                  | parity      | `MockWhatsAppClient` + `WhatsAppClient` against the same input |
| Real Meta sandbox calls                                          | E2E (gated) | `WHATSAPP_E2E=1`, nightly only                                 |

**For your own application code**, the recommended default is:

1. **Unit tests** against your business logic (intent classifier, slot
   ledger, escalation detector). No SDK in the test.
2. **Contract tests** that wire `MockWhatsAppClient` (via
   `pickWhatsAppClient` with `WHATSAPP_MODE=mock`) and assert on
   `mock.sentMessages`. Fast, no network, deterministic wamids.
3. **One smoke E2E** per critical flow against Meta's sandbox, gated
   by env. Don't mass-test against Meta — they rate-limit you.

```ts
import { describe, it, expect } from "vitest";
import { MockWhatsAppClient, type TemplateDefinition } from "@dojocoding/whatsapp";

it("sends booking confirmation as a UTILITY template", async () => {
  const def: TemplateDefinition = {
    id: "T1",
    name: "booking_confirmed",
    language: "en_US",
    category: "UTILITY",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hi {{1}}, see you on {{2}}." }],
  };
  const mock = new MockWhatsAppClient({
    phoneNumberId: "P",
    wabaId: "W",
    templates: [def], // ← seeded registry; no vi.spyOn needed
  });

  await sendBookingConfirmation(mock, "521234567890", "Daniel", "Tue 10am");

  expect(mock.sentMessages).toHaveLength(1);
  expect(mock.sentMessages[0]?.payload.type).toBe("template");
});
```

**Don't:**

- Mock `fetch` directly in your tests when the SDK's
  `MockWhatsAppClient` already gives you a higher-level mock.
  Lower-level mocks couple your tests to SDK internals.
- Test the SDK's behaviour in your own repo. The SDK has its own
  tests; your job is to test _your_ code's interaction with it.
- Run E2E against Meta on every commit. Run it nightly, alert on
  failure, don't gate PRs on it.
