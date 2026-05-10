# Cookbook

Use-case-driven recipes. Each is a runnable shape you can lift into your
own app, with the "why" up front and the gotchas right after.

If you just want to send a message or set up a webhook receiver, start
with [`../quickstart.md`](../quickstart.md). The cookbook is for when
you've moved past hello-world and need a pattern for a real shape.

## Recipes

| When you want to…                                                                    | Recipe                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Reply to inbound messages with canned answers (FAQ-style)                            | [Inbound auto-responder](./inbound-auto-responder.md)             |
| Fire transactional notifications from external events (Stripe, Shopify, calendar, …) | [Transactional notification](./transactional-notification.md)     |
| Run a bot for tier-1 with clean handoff to a human                                   | [Two-way support with handoff](./two-way-support-with-handoff.md) |
| Collect structured information across turns (booking flows, lead qual)               | [Appointment booking](./appointment-booking.md)                   |
| Operate one SDK deployment for multiple WhatsApp Business Accounts                   | [Multi-tenant](./multi-tenant.md)                                 |
| Run on Cloudflare Workers / Bun / Deno via the Fetch-API handler                     | [Cloudflare Workers](./cloudflare-workers.md)                     |

## What every recipe assumes

- Node ≥ 20, ESM imports, TypeScript strict on.
- The four required env vars are loaded somehow
  (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_TOKEN`,
  `WHATSAPP_APP_SECRET`) plus `WHATSAPP_VERIFY_TOKEN` for receivers.
  See [`../../.env.example`](../../.env.example).
- A working webhook endpoint reachable by Meta (ngrok / cloudflared in
  dev). Recipes show the Express middleware mount; substitute your
  framework's adapter as needed.
- The reader is comfortable with discriminated unions (`event.kind`,
  `payload.type`). If not, [`../messages.md`](../messages.md) and
  [`../webhooks.md`](../webhooks.md) explain.

## Cross-references

- For composable building blocks (window-aware send, idempotent
  handler, escalation, multi-tenant), see
  [`../patterns.md`](../patterns.md).
- For "what's allowed by Meta," see
  [`../compliance.md`](../compliance.md).
- For agents authoring code that uses this SDK, see
  [`../../AGENTS.md`](../../AGENTS.md) — the operating context.
