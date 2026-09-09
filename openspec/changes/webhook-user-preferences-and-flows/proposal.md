# Change proposal — parse `user_preferences`, WhatsApp Flows replies, and CTWA welcome triggers

Affected capability: `webhook-receiver`.

## Why

Three Meta webhook shapes the SDK receives today were invisible or
mislabelled (audit findings F8 webhook half, F11; probes P8, P9):

- **`user_preferences`** (Nov 2024) — Meta's authoritative
  "stop / resume marketing messages" signal — fell through to
  `kind: "unknown"`. The SDK ships an `OptInRegistry` to gate
  MARKETING sends but offered no typed hook to populate it from the
  one signal Meta actually enforces (`131050` on the next send, and
  since Apr 2026 WABA-level penalties for repeated `131049` retries).
- **`interactive.type: "nfm_reply"`** (WhatsApp Flows completion,
  `response_json`) normalised to `"unsupported"`.
- **`type: "request_welcome"`** (Click-to-WhatsApp conversation
  opened before the user typed — the welcome-message trigger inside
  the 72 h free entry point) also normalised to `"unsupported"`.

Because `"unsupported"` is also what Meta sends for genuinely
unsupported messages, consumers could not tell a Flow completion
from an unreadable message without digging into `body`.

## What Changes

- `IncomingMessageKind` gains `"interactive_nfm_reply"` and
  `"request_welcome"`; the parser maps them.
- New `UserPreferencesEvent` (`waId`, `category`, `value`,
  `detail?`, `raw`) emitted once per `user_preferences[]` entry;
  `EventKindMap.user_preferences` so `.on("user_preferences", h)` is
  typed; deduped on `waId + category + value + timestamp`.
- Fixtures: `user-preferences-stop.json`,
  `interactive-nfm-reply.json`, `request-welcome.json`.
- Docs: `docs/sdk/webhooks.md` event table + notes;
  `docs/sdk/opt-in.md` "Meta's native opt-out signal" section
  wiring the event to `registry.optOut` / `optIn` scoped to
  `MARKETING`.

## Non-goals

- Parsing `response_json` — it is Flow-specific; the SDK preserves
  the string.
- Auto-wiring `user_preferences` into a registry (the SDK has no
  registry reference at receiver level; the bridge/cookbooks show
  the one-liner).

## Impact

- `webhook-receiver` spec: 2× MODIFIED, 1× ADDED requirement.
- Additive. Consumers that special-cased `type === "unsupported"`
  for Flows replies must switch to `"interactive_nfm_reply"`. Minor.
