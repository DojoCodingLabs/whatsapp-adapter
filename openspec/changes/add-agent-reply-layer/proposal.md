# Change proposal — agent reply layer

New capability: `agent-reply`. Also modifies `framework-adapters`
(web adapter: `verifyAndParseWebhook`, 400 for signed non-JSON
bodies).

## Why

LLM agents (Printa on Vercel eve 1.3.0, Doji) each re-implemented
the same outbound glue on top of raw Graph calls: split long text at
4096 without losing characters, clip model-written button titles to
Meta's limits, dedupe options, send an over-long interactive prompt
as text first, fall back to numbered text when Meta refuses an
interactive message, decide session vs template vs drop around the
24-hour window, and catch typed "STOP" / "baja" messages. The proven
version lives in doji-agent (`src/whatsapp/graph.ts`, `reply.ts`,
`optout.ts`) with tests. Moving it into the SDK lets agents use the
SDK's typed client, typed errors and strict builders instead.

Frameworks that own routing (eve `defineChannel` POST routes) cannot
use `createWhatsAppHandler`, which needs a `WebhookReceiver` and
builds the `Response`. They need verify + parse only.

## What Changes

- New `packages/whatsapp-sdk/src/reply/`: `splitText`, `clipText`,
  `toWhatsAppText`, `Reply` union, `toInteractiveReply` (tolerant;
  output validated by the existing strict builders), `replyAsText`,
  `deliverReply` (split, long-body continuation via a caller option,
  plain-text fallback, typed errors propagate), `outboundMode` +
  `WINDOW_MARGIN_MS`, `detectOptOut`. Exported from the root entry.
- Web adapter: `verifyAndParseWebhook(req, { appSecret })` →
  `401 | 400 | { 200, events, rawBody }`.
- Behaviour change: `createWhatsAppHandler` (and the Express / Hono
  shims over it) returns `400` for a correctly signed body that is
  not JSON, instead of `200` with zero events.
- Docs: `docs/sdk/reply.md`, `docs/sdk/web.md`, `docs/README.md`.

## Non-goals

- No consumer copy in the SDK: no opt-out acknowledgement, no
  Spanish / emoji continuation body (option with neutral default).
- No eve dependency, no eve interaction mapping, link codes,
  Telegram, or identity hashing for eve addresses.
- `detectOptOut` does not replace Meta's `user_preferences` webhook
  or error `131050`; it does not store anything.
- Not changing the strict builders or `MESSAGE_LENGTH_LIMITS` (the
  list body limit is corrected by a separate change).
