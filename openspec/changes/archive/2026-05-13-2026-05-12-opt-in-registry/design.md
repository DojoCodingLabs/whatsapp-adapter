# Design — `OptInRegistry`

## Context

The SDK ships several pluggable primitives — `Storage`,
`WindowTracker`, `TokenProvider`, `RateLimitedQueue` — that
share a single design language:

1. A small interface (3-5 methods) that a consumer can
   implement against any backend.
2. An in-memory default for tests + simple deployments.
3. An optional constructor field on `WhatsAppClient` (or
   wherever the primitive integrates) that defaults to "off".
4. A typed error class for the policy violation, surfacing
   through the standard `WhatsAppError` hierarchy.

`OptInRegistry` is the fourth primitive in this family. Same
shape, same plug points, same testing story.

## Goals

- Ship a primitive that turns "consumer rolls their own
  consent ledger" into "consumer wires their existing consent
  data through a 3-method interface".
- Keep the integration optional — existing consumers see no
  behaviour change.
- Surface opt-out as a typed `WhatsAppError` so the MCP
  server's existing error-mapping pipeline catches it
  automatically (with a recovery hint).
- Match the in-memory + Redis + Postgres pattern of `Storage`
  so consumers can swap implementations the same way.

## Non-Goals

- **Built-in consent UI / opt-in collection flow.** Out of
  scope — the SDK doesn't own consent acquisition (web forms,
  WhatsApp consent prompts, etc.).
- **Cross-tenant consent sharing.** The registry is
  per-`WhatsAppClient` (i.e. per-WABA-phone pair). Multi-tenant
  deployments use one registry per tenant or implement
  tenant-aware key prefixing in their adapter.
- **Free-form send gating.** Free-form sends are gated by the
  24h window which implies implicit consent. Gating those on
  the registry too would double-gate and confuse the failure
  mode.
- **Auto-opt-out from inbound `STOP` / `unsubscribe` keywords.**
  Out of scope; consumers wire this themselves by reacting to
  inbound messages in their `WebhookReceiver.on("message")`
  handler and calling `registry.optOut(e.from, ...)`. Could be
  a future helper utility but not in this change.
- **Pre-flight on `sendReaction`.** Reactions are part of an
  existing thread; opted-out users wouldn't be sending the
  inbound message we're reacting to anyway.

## Decisions

### 1. Why category-scoped opt-out

Meta's template categories (`MARKETING`, `UTILITY`,
`AUTHENTICATION`) carry different consent semantics:

- **MARKETING** — strict opt-in regimes apply (GDPR, Ley 8968,
  CAN-SPAM unsubscribe headers). High user-side annoyance.
- **UTILITY** — transactional (order updates, appointment
  reminders). Lower bar; often considered service-essential.
- **AUTHENTICATION** — OTP delivery. User explicitly requested
  by initiating a sign-in flow.

A user might opt out of marketing pushes but still want OTP
delivery. Category-scoped opt-out captures this. When
`category` is omitted on `optOut`, it's a global opt-out
(blocks all categories).

### 2. Why soft opt-in (default)

Two failure modes the design must avoid:

- **Hard opt-in default**: `isOptedIn` returns false for
  unknown recipients. Consumers using this without seeding
  the registry get a `OptOutError` on every send — surprising
  and footgun-y.
- **No default behaviour**: forcing every deployment to
  bring their own registry from day one is a heavy
  onboarding cost.

Soft opt-in (consent assumed unless explicitly opted out)
matches what most existing consumer code does today and is
the principle-of-least-surprise default. Strict-regime
consumers (Ley 8968 marketing pushes) implement their own
registry that returns `false` until explicitly opted in.

### 3. Why a typed error, not a boolean return

The send methods (`sendTemplate`, etc.) already throw typed
`WhatsAppError` subclasses on policy violations
(`WindowClosedError`, `RateLimitError`, etc.). The MCP server
maps these to canonical recovery-hint responses
(`docs/mcp/error-recovery.md`).

Returning `{ sent: false, reason: "opted_out" }` would break
the existing pattern; throwing `OptOutError` matches it. The
MCP error mapper extends with one new branch:

```ts
if (error instanceof OptOutError) {
  return "Recipient has opted out... record consent before re-sending.";
}
```

### 4. Why last-4 redaction on `OptOutError.recipient`

The error's `message` property lands in logs by default. A
full phone number is PII; the last-4 digits are sufficient for
debugging while reducing PII exposure. This matches the
existing `AuthenticationError` redaction pattern.

The full recipient is still available via the original input
(`input.to` on the caller side). The error's `recipient`
field stores last-4 only.

### 5. Why `category` is optional on the interface

Some consumers don't need category-scoped opt-out — they
track a single global flag. Making category optional on every
method lets them implement against the global semantic and
ignore the parameter.

Consumers needing category scoping implement an adapter that
keys storage by `(recipient, category)`.

### 6. Why pre-flight in the client (not the builder or transport)

The builder (`buildTemplate`) and transport (`request`) are
pure functions. Pre-flight needs:
- Access to the configured `optInRegistry` — lives on the
  client.
- Access to the recipient — available on `input.to`.
- Visibility into the template category — `input.category`
  on `BuildTemplateInput`.

The client is the only place that has all three. Pre-flight
in `client.sendTemplate(...)` (and the two auth/carousel
siblings) is the natural fit.

### 7. Why not pre-flight on `listTemplates` / `getTemplate`

Read operations have no consent semantic — they don't reach
the recipient. Only send paths gate.

### 8. Why `InMemoryOptInRegistry` is its own class

Mirrors `InMemoryStorage`. Lets consumers do
`new InMemoryOptInRegistry()` in tests without pulling in a
Redis/Postgres dependency. Also lets the SDK ship an in-memory
default for the MockWhatsAppClient pre-flight tests.

### 9. Pluggable storage adapter

`InMemoryOptInRegistry` is the only ship-default. Consumers
wanting persistence implement against the `OptInRegistry`
interface directly. The cookbook documents the canonical
Postgres-backed pattern:

```ts
class PostgresOptInRegistry implements OptInRegistry {
  constructor(private pool: Pool) {}
  async isOptedIn(recipient: string, opts?: OptInQuery): Promise<boolean> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM opt_outs WHERE recipient = $1 AND ($2::text IS NULL OR category = $2) LIMIT 1",
      [recipient, opts?.category ?? null]
    );
    return rows.length === 0;
  }
  async optIn(recipient: string, meta?: OptInMeta): Promise<void> {
    await this.pool.query(
      "DELETE FROM opt_outs WHERE recipient = $1 AND ($2::text IS NULL OR category = $2)",
      [recipient, meta?.category ?? null]
    );
    // Optional: insert into opt_ins audit table.
  }
  async optOut(recipient: string, opts?: OptOutOptions): Promise<void> {
    await this.pool.query(
      "INSERT INTO opt_outs (recipient, category, reason, timestamp) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
      [recipient, opts?.category ?? null, opts?.reason ?? null, opts?.timestamp ?? Date.now()]
    );
  }
}
```

The SDK doesn't bundle this — Postgres-using consumers
implement it inline. Same pattern as `Storage` adapters.

### 10. Mock client behaviour

`MockWhatsAppClient` adopts the same `optInRegistry?` option
and pre-flight logic. This keeps the parity contract (real
client and mock honour the same gating semantics) intact and
lets tests exercise opt-out paths without HTTP.

### 11. Spec-discipline note

This is the FIRST new capability since `mock-mode` shipped.
New capabilities require a new spec file under
`openspec/specs/<capability>/spec.md`. The archive will
create `openspec/specs/opt-in-registry/spec.md` with the
ADDED requirements from this proposal's spec delta.
