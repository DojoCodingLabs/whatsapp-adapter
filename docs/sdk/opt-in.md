# Opt-in registry (`OptInRegistry`)

A pluggable consent-state primitive. Mirrors `Storage` in
shape: small, async, deliberate. Used by `WhatsAppClient` to
pre-flight template sends against recorded consent state.

Optional — when omitted, the SDK preserves its existing
behaviour (no gating). When configured, the SDK gates
`sendTemplate`, `sendAuthTemplate`, and `sendCarouselTemplate`;
free-form sends are unaffected (already gated by the 24h
window).

## Quick reference

```ts
import { InMemoryOptInRegistry, OptOutError, WhatsAppClient } from "@dojocoding/whatsapp-sdk";

const registry = new InMemoryOptInRegistry();

const client = new WhatsAppClient({
  phoneNumberId,
  wabaId,
  token,
  appSecret,
  optInRegistry: registry,
});

// Inbound webhook handler — react to opt-out keywords:
receiver.on("message", async (e) => {
  if (e.body?.text?.body?.toUpperCase().trim() === "STOP") {
    await registry.optOut(e.from, { reason: "stop-keyword" });
  }
});

// Outbound template send — pre-flight runs automatically:
try {
  await client.sendTemplate({ to, name: "promo", language: "es_MX" });
} catch (err) {
  if (err instanceof OptOutError) {
    // Recipient has opted out. Don't send. Don't retry until consent is re-recorded.
  }
}
```

## Interface

```ts
export interface OptInRegistry {
  isOptedIn(recipient: string, options?: OptInQuery): Promise<boolean>;
  optIn(recipient: string, meta?: OptInMeta): Promise<void>;
  optOut(recipient: string, options?: OptOutOptions): Promise<void>;
}

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface OptInQuery {
  category?: TemplateCategory;
}

export interface OptInMeta {
  category?: TemplateCategory;
  source?: string;
  timestamp?: number;
  attributes?: Record<string, unknown>;
}

export interface OptOutOptions {
  category?: TemplateCategory;
  reason?: string;
  timestamp?: number;
}
```

### `isOptedIn(recipient, options?)`

Returns `false` when the recipient has been explicitly opted
out of the queried category (or globally, when `category` is
omitted on the query). Returns `true` otherwise — including
for recipients with no recorded state.

This is **soft opt-in**: consent assumed unless explicitly
opted out. Strict **hard opt-in** regimes (Ley 8968 marketing
pushes, GDPR-strict) implement their own registry that
returns `false` until `optIn` has been called.

### `optIn(recipient, meta?)` and `optOut(recipient, options?)`

Idempotent. Record explicit consent state. `meta` and
`options` are captured for audit purposes but only the
category dimension affects subsequent `isOptedIn` queries
(reasons, sources, timestamps, attributes are stored but not
gating-relevant).

A category-scoped `optIn` clears any prior opt-out for the
same category. A global `optIn` (no category) supersedes
every category-scoped opt-out.

## Default implementation: `InMemoryOptInRegistry`

```ts
import { InMemoryOptInRegistry } from "@dojocoding/whatsapp-sdk";

const registry = new InMemoryOptInRegistry();
```

Tracks state in process-local Maps. Safe for tests,
development, and single-process production deployments. Not
appropriate for multi-process / multi-node deployments —
state lives in one process only.

## Category semantics

Meta categorises templates as `MARKETING`, `UTILITY`, or
`AUTHENTICATION`. Each has different consent expectations:

- **MARKETING** — strict opt-in regimes apply (GDPR, Ley
  8968, CAN-SPAM unsubscribe headers). High user-side
  annoyance threshold.
- **UTILITY** — transactional (order updates, appointment
  reminders, account alerts). Lower bar; often considered
  service-essential.
- **AUTHENTICATION** — OTP delivery. User explicitly
  requested by initiating a sign-in flow.

Category-scoped opt-outs let users unsubscribe from
marketing pushes while still receiving OTPs:

```ts
await registry.optOut("+5210000000001", { category: "MARKETING" });

await registry.isOptedIn("+5210000000001", { category: "MARKETING" });
// false

await registry.isOptedIn("+5210000000001", { category: "AUTHENTICATION" });
// true
```

A global opt-out (no `category` argument) blocks every
category — appropriate when a user has fully disengaged.

## Pre-flight gating in `WhatsAppClient`

When `optInRegistry` is configured on the client, three
methods consult it before issuing the Graph API call:

| Method                           | Category passed                                         | Gating                  |
| -------------------------------- | ------------------------------------------------------- | ----------------------- |
| `sendTemplate(input)`            | `input.validateAgainst?.category` (default `MARKETING`) | Pre-flight              |
| `sendAuthTemplate(input)`        | `AUTHENTICATION`                                        | Pre-flight              |
| `sendCarouselTemplate(input)`    | `MARKETING`                                             | Pre-flight              |
| `sendText` / media / interactive | —                                                       | NOT gated (window only) |
| `sendReaction`                   | —                                                       | NOT gated               |
| `listTemplates` / `getTemplate`  | —                                                       | NOT gated (read-only)   |

On a `false` return from `registry.isOptedIn(...)`, the
client throws `OptOutError(recipient, category)` and the
Graph API request is NOT issued. The recipient is redacted
to last-4 (`***1234`) in the error's message and `recipient`
field — full phone number is PII.

### Why free-form sends aren't gated

Free-form sends (`sendText`, `sendImage`, etc.) require an
open 24-hour customer-service window. The window only opens
when the customer initiates contact, which is an implicit
consent signal under most regulatory regimes. Double-gating
free-form sends on the registry would block legitimate
customer-initiated conversations and confuse the failure
mode.

## Inbound opt-out keywords

The SDK does NOT auto-process inbound STOP / unsubscribe /
BAJA keywords as opt-outs. Consumers wire this themselves in
their `WebhookReceiver.on("message")` handler:

```ts
const STOP_KEYWORDS = new Set(["STOP", "BAJA", "UNSUBSCRIBE", "PARAR"]);

receiver.on("message", async (e) => {
  const text = (e.body?.text?.body as string | undefined)?.toUpperCase().trim();
  if (text !== undefined && STOP_KEYWORDS.has(text)) {
    await registry.optOut(e.from, { reason: "stop-keyword", timestamp: Date.now() });
    // Optional: send a confirmation template before the opt-out takes effect:
    //   await client.sendTemplate({ to: e.from, name: "unsubscribe_confirm", ... });
    //   ↑ Sent before the optOut() above lands in some flows.
  }
});
```

Why this isn't built in:

- **Locale variance.** `STOP` works in English; `BAJA` in
  Spanish; `STOPP` in German; etc.
- **Per-tenant policy.** Some businesses confirm the opt-out
  via a follow-up template; others process it instantly. The
  SDK shouldn't pick.
- **Compound keywords.** `STOP ALL` vs `STOP MARKETING` vs
  `STOP UTILITY` are real patterns that need per-tenant
  parsing.

The pattern is one screen of code. Build it once per tenant.

## Custom registries (Postgres / Redis / SaaS)

The interface is small — implement against any backend. See
[`docs/cookbook/sdk/opt-in-postgres.md`](../cookbook/sdk/opt-in-postgres.md)
for the canonical Postgres adapter, including the migration
SQL and the inbound STOP-keyword handler.

The SDK doesn't ship a Postgres / Redis adapter for the
opt-in registry — unlike `Storage`, the consent shape varies
heavily by deployment (audit trail requirements, retention
policy, multi-tenant key prefixing, integration with an
external consent ledger). Adapters live in the consumer
codebase.

## `OptOutError` shape

```ts
export class OptOutError extends WhatsAppError {
  public override readonly code = "OPT_OUT" as const;
  public readonly recipient: string; // last-4 redaction: "***1234"
  public readonly category: TemplateCategory | undefined;
}
```

The MCP server maps this to a canonical recovery hint
visible to LLM agents — see
[`docs/mcp/error-recovery.md`](../mcp/error-recovery.md)
under `OPT_OUT`.

## Hard opt-in pattern

The default semantics are soft opt-in (consent assumed
unless explicitly opted out). To enforce strict hard opt-in
(consent required for every recipient before any send),
implement a registry that returns `false` unless
`optIn(...)` has been called:

```ts
import type { OptInQuery, OptInRegistry, OptInMeta, OptOutOptions } from "@dojocoding/whatsapp-sdk";

class HardOptInRegistry implements OptInRegistry {
  readonly #consented: Set<string> = new Set();
  readonly #optedOut: Set<string> = new Set();

  async isOptedIn(recipient: string, _options?: OptInQuery): Promise<boolean> {
    if (this.#optedOut.has(recipient)) return false;
    return this.#consented.has(recipient);
  }

  async optIn(recipient: string, _meta?: OptInMeta): Promise<void> {
    this.#consented.add(recipient);
    this.#optedOut.delete(recipient);
  }

  async optOut(recipient: string, _options?: OptOutOptions): Promise<void> {
    this.#optedOut.add(recipient);
    this.#consented.delete(recipient);
  }
}
```

Wire your own consent-acquisition flow (web form, WhatsApp
double-opt-in template, etc.) to call `registry.optIn(...)`
on confirmation.

## See also

- [`docs/compliance.md`](../compliance.md) — Meta + Ley
  8968 rules and which the SDK enforces.
- [`docs/cookbook/sdk/opt-in-postgres.md`](../cookbook/sdk/opt-in-postgres.md)
  — Postgres-backed registry recipe.
- [`docs/mcp/error-recovery.md`](../mcp/error-recovery.md) —
  the MCP recovery hint for `OPT_OUT`.
