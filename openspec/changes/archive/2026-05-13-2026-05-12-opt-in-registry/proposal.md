# Change proposal — `OptInRegistry` capability for consent-gated template sends

## Why

WhatsApp policy (and Costa Rica's Ley 8968 datos personales)
require **opt-in consent** before sending marketing templates.
The SDK currently treats this as the consumer's responsibility
— [`docs/compliance.md`](../../../docs/compliance.md) explicitly
says "consumer-side policy is your responsibility on either
path."

That's fine for transactional flows (where opt-in is implicit
in the customer initiating contact), but **template sends** —
particularly MARKETING category — need a pre-flight consent
check. Today, every consumer rolls this themselves: a
`conversations.opted_out` boolean somewhere, a custom check
before every `client.sendTemplate(...)` call. The shape repeats
across deployments and is easy to forget.

Site2Print called this out in the integration audit (B7.1):
"a thin `OptInRegistry` interface — the same shape as
`Storage` — would let us share the contract." That's the right
move. The SDK's `Storage`-shaped abstraction is the canonical
pluggable-state pattern; mirroring it for opt-in state gives
consumers a uniform integration surface across in-memory,
Redis, Postgres, and consent-ledger SaaS backends.

## What Changes

### New capability: `opt-in-registry`

A new capability with a small public surface:

```ts
export interface OptInRegistry {
  /**
   * Returns true if `recipient` has consented to receive
   * messages of the given category. When `category` is
   * omitted, returns the overall opt-in status (false only
   * if the recipient has opted out of ALL categories).
   */
  isOptedIn(recipient: string, options?: OptInQuery): Promise<boolean>;

  /**
   * Record consent for this recipient. Idempotent — calling
   * twice is a no-op.
   */
  optIn(recipient: string, meta?: OptInMeta): Promise<void>;

  /**
   * Record opt-out. Once opted out, `isOptedIn` SHALL return
   * `false` for that recipient (and category, when scoped).
   */
  optOut(recipient: string, options?: OptOutOptions): Promise<void>;
}

export interface OptInQuery {
  /** Optional template category filter. */
  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
}

export interface OptInMeta {
  /** Category being opted into. If omitted, opt-in applies globally. */
  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  /** Where the consent came from — webhook, web form, etc. */
  source?: string;
  /** Consent timestamp (ms). Defaults to current time. */
  timestamp?: number;
  /** Free-form metadata (e.g. consent record id, IP, user agent). */
  attributes?: Record<string, unknown>;
}

export interface OptOutOptions {
  /** Category being opted out of. If omitted, opt-out applies globally. */
  category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  /** Reason for the opt-out (audit log). */
  reason?: string;
  /** Opt-out timestamp (ms). Defaults to current time. */
  timestamp?: number;
}

export class InMemoryOptInRegistry implements OptInRegistry { ... }
```

`OptInRegistry` is shaped to mirror `Storage` — pluggable,
async, deliberate.

### New typed error: `OptOutError`

Extending the existing `WhatsAppError` hierarchy:

```ts
export class OptOutError extends WhatsAppError {
  public override readonly code = "OPT_OUT" as const;
  /** Last-4 digits of the recipient phone (full number is PII). */
  public readonly recipient: string;
  public readonly category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  constructor(recipient: string, category?: OptOutOptions["category"]) {
    super("OPT_OUT", `Recipient ${recipient} has opted out${category ? ` of ${category}` : ""}.`);
    this.recipient = recipient;
    if (category !== undefined) this.category = category;
  }
}
```

The `WhatsAppErrorCode` union grows to include `"OPT_OUT"`.

### New `WhatsAppClient` option: `optInRegistry?`

```ts
interface WhatsAppClientOptions {
  // ...existing fields...
  optInRegistry?: OptInRegistry;
}
```

When configured, the client SHALL pre-flight consent BEFORE
issuing a template HTTP call. Specifically: `sendTemplate`,
`sendAuthTemplate`, and `sendCarouselTemplate` invoke
`optInRegistry.isOptedIn(input.to, { category })` and throw
`OptOutError` on a `false` return.

Free-form sends (`sendText`, `sendImage`, etc.) do NOT consult
the registry — those are already gated by the 24-hour
customer-service window, which implies the customer initiated
contact (an implicit consent signal under most regimes).

### Default behaviour: `InMemoryOptInRegistry`

The in-memory default tracks explicit opt-ins and opt-outs
separately. `isOptedIn` returns:

- `false` if the recipient has explicitly opted out of the
  queried category (or globally, when category isn't scoped).
- `true` otherwise — including for recipients with no recorded
  consent state.

This is **soft opt-in** (consent assumed; opt-outs override).
It protects against unsubscribes — the most critical compliance
need across most regimes — without forcing every send to fail
until consent is explicitly recorded. Consumers wanting strict
**hard opt-in** (consent required before any send) implement
their own registry backed by a database; the interface is
identical.

### Docs

- New page `docs/sdk/opt-in.md` — `OptInRegistry` reference.
- New cookbook `docs/cookbook/sdk/opt-in-postgres.md` —
  Postgres-backed registry recipe.
- `docs/compliance.md` § "Opt-in / opt-out" updated to point at
  the new primitive.

## Impact

- **New capability spec** under `openspec/specs/opt-in-registry/`
  with 4× ADDED requirements.
- **`cloud-api-client` capability:** 1× MODIFIED requirement on
  the template-send section (adds the pre-flight check).
- **Release impact:** ships as part of `sdk-v1.1.0`. Lands on
  `main` ahead of the v1 stability tag.
- **Stability:** the `OptInRegistry` interface, `OptOutError`
  class, and `optInRegistry?` option are part of the v1
  stability commitment from `sdk-v1.1.0` onwards.
- **Breaking?** No. The new option is optional with a
  backward-compatible default (no gating). The
  `WhatsAppErrorCode` union grows with one new literal —
  consumers exhaustive-switching over the union see a
  compile-time hint (non-breaking under strict-null TypeScript
  semantics since exhaustiveness is opt-in).
