## ADDED Requirements

### Requirement: OptInRegistry interface

The SDK SHALL export an `OptInRegistry` interface with three
methods: `isOptedIn`, `optIn`, `optOut`. The interface SHALL
be pluggable — any consumer can implement it against an
arbitrary backend (in-memory, Redis, Postgres, consent-ledger
SaaS, etc.). The shape mirrors the SDK's `Storage` interface:
small, async, deliberate.

```ts
export interface OptInRegistry {
  isOptedIn(recipient: string, options?: OptInQuery): Promise<boolean>;
  optIn(recipient: string, meta?: OptInMeta): Promise<void>;
  optOut(recipient: string, options?: OptOutOptions): Promise<void>;
}

export interface OptInQuery {
  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
}

export interface OptInMeta {
  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  source?: string;
  timestamp?: number;
  attributes?: Record<string, unknown>;
}

export interface OptOutOptions {
  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  reason?: string;
  timestamp?: number;
}
```

`OptInRegistry.isOptedIn` SHALL return:

- `false` when the recipient has been explicitly opted out
  of the queried category (or globally, when `category` is
  omitted on the query).
- `true` otherwise — including for recipients with no
  recorded state.

This is "soft opt-in" (consent assumed unless explicitly
opted out). Strict "hard opt-in" regimes implement their own
registry that returns `false` until `optIn` has been called.

`optIn` and `optOut` SHALL both be idempotent — calling
either twice with the same arguments SHALL have the same
observable effect as calling it once.

#### Scenario: Unknown recipient is opted in by default

- **GIVEN** an `InMemoryOptInRegistry` with no recorded state
- **WHEN** `isOptedIn("+5210000000001")` is called
- **THEN** the return value SHALL be `true`

#### Scenario: optOut then isOptedIn returns false

- **GIVEN** an `OptInRegistry`
- **WHEN** `optOut("+5210000000001")` is called, then `isOptedIn("+5210000000001")`
- **THEN** `isOptedIn` SHALL return `false`

#### Scenario: Category-scoped opt-out

- **GIVEN** an `OptInRegistry`
- **WHEN** `optOut("+5210000000001", { category: "MARKETING" })` is called
- **THEN** `isOptedIn("+5210000000001", { category: "MARKETING" })` SHALL return `false`
- **AND** `isOptedIn("+5210000000001", { category: "UTILITY" })` SHALL return `true`

#### Scenario: Global opt-out blocks every category

- **GIVEN** an `OptInRegistry`
- **WHEN** `optOut("+5210000000001")` is called with no category
- **THEN** `isOptedIn("+5210000000001", { category: "MARKETING" })` SHALL return `false`
- **AND** `isOptedIn("+5210000000001", { category: "UTILITY" })` SHALL return `false`

#### Scenario: optIn after optOut re-consents

- **GIVEN** an `OptInRegistry` with a prior opt-out
- **WHEN** `optIn("+5210000000001")` is called
- **THEN** `isOptedIn("+5210000000001")` SHALL return `true`

#### Scenario: optIn and optOut are idempotent

- **WHEN** `optIn("+5210000000001")` is called twice
- **THEN** the registry state SHALL match calling it once

### Requirement: InMemoryOptInRegistry default

The SDK SHALL ship `InMemoryOptInRegistry` — a default
in-memory implementation of `OptInRegistry`. The class SHALL
be constructable with zero arguments and SHALL track explicit
opt-ins and opt-outs in process-local state.

The implementation SHALL be safe to use across concurrent
async operations within one process. It SHALL NOT make any
network or file-system calls.

The class is appropriate for development, testing, and
single-process production deployments. Multi-process or
multi-node deployments SHALL implement a registry backed by
shared storage (Redis, Postgres, etc.).

#### Scenario: InMemoryOptInRegistry honours the interface contract

- **WHEN** `new InMemoryOptInRegistry()` is constructed and exercised against the `OptInRegistry` contract
- **THEN** every scenario in "Requirement: OptInRegistry interface" SHALL hold

### Requirement: OptOutError typed error class

The SDK SHALL export an `OptOutError` class extending
`WhatsAppError`. The class SHALL be thrown by the SDK's
template send methods when the configured `OptInRegistry`
reports the recipient as opted out.

The class SHALL:

- Have `code === "OPT_OUT"` (added to the
  `WhatsAppErrorCode` union).
- Carry a public readonly `recipient: string` field
  containing the last-4 digits of the recipient phone (PII
  redaction; matches the existing `AuthenticationError`
  redaction pattern).
- Carry an optional public readonly `category` field naming
  the category the opt-out applies to (when scoped).
- Have a message of the form
  `"Recipient ***1234 has opted out of MARKETING."` —
  redacted recipient + category when present.

#### Scenario: OptOutError redacts the recipient to last-4

- **WHEN** `new OptOutError("+5210000000001", "MARKETING")` is constructed
- **THEN** `error.recipient` SHALL equal `"***0001"` (last-4 with prefix marker)
- **AND** `error.message` SHALL NOT contain any digit other than the last 4 of the recipient
- **AND** `error.code` SHALL equal `"OPT_OUT"`
- **AND** `error.category` SHALL equal `"MARKETING"`

#### Scenario: OptOutError without category

- **WHEN** `new OptOutError("+5210000000001")` is constructed (no category)
- **THEN** `error.message` SHALL NOT mention any category
- **AND** `error.category` SHALL be `undefined`

### Requirement: Inbound STOP-keyword auto-opt-out is a consumer concern

The SDK SHALL NOT auto-process inbound "STOP" /
"unsubscribe" / "BAJA" keywords as opt-outs. Consumers
implement this themselves by reacting to inbound messages
in their `WebhookReceiver.on("message")` handler and
calling `registry.optOut(event.from, ...)`.

This is documented in `docs/sdk/opt-in.md` § "Inbound
opt-out keywords" with a canonical pattern.

The reasoning is that "STOP keyword recognition" varies by
language, locale, and per-tenant policy. A built-in keyword
list would be wrong for every consumer who doesn't match the
SDK's default. The pattern is worth documenting; the
implementation is consumer-side.

#### Scenario: An inbound "STOP" message does not auto-opt-out

- **GIVEN** a `WebhookReceiver` with a configured handler and an `OptInRegistry`
- **WHEN** an inbound `MessageEvent` arrives with `body.text.body === "STOP"`
- **THEN** the SDK SHALL NOT automatically call `registry.optOut(...)`
- **AND** the registry state SHALL remain unchanged until the consumer's handler explicitly calls `optOut`
