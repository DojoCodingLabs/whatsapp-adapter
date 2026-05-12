# Change proposal — `waitUntil` integration for the web adapter

## Why

The Fetch-API web adapter (`@dojocoding/whatsapp-sdk/web`) acks
Meta's webhook with `200 OK` BEFORE awaiting handlers — that's
the whole point of the
`result.dispatchPromise.catch(onUnhandledHandlerError)` pattern
at `packages/whatsapp-sdk/src/adapters/web/index.ts:84`. On
long-running servers (Node, Bun standalone), this works because
the Promise survives the response.

**On Vercel serverless and Cloudflare Workers, it doesn't.**
The runtime invokes the function, waits for the `Response`, and
then **kills the invocation immediately**. Any in-flight
`dispatchPromise` is dropped silently — including handler
errors, OTel spans, and any side-effects the handler is
responsible for (write to DB, send a follow-up, etc.).

The standard runtime escape hatch for this is `waitUntil(promise)`:

- **Vercel:** the App Router passes a request with a
  `waitUntil` semantic exposed via `event.waitUntil` (Edge) or
  the `@vercel/functions` `waitUntil()` helper (Node).
- **Cloudflare Workers:** `ctx.waitUntil(promise)` on the
  fetch handler's `ExecutionContext`.
- **Both Bun and Deno:** standalone HTTP servers don't need
  `waitUntil` — the Promise simply lives on.

Site2Print runs the SDK on Vercel serverless. Today, async
handler dispatch is silently dropped. This change wires
`waitUntil` through the web adapter so the dispatch survives.

## What Changes

### Public surface addition

- **NEW** `CreateWhatsAppHandlerOptions.waitUntil?: (promise: Promise<unknown>) => void`
- When supplied, the adapter SHALL call `waitUntil(dispatchPromise.catch(onUnhandledHandlerError))`
  immediately before returning the `Response`.
- When omitted, behaviour is unchanged: the adapter calls
  `dispatchPromise.catch(onUnhandledHandlerError)` and lets the
  promise live as a "fire and forget" task (works on long-lived
  runtimes).

### Behaviour invariants preserved

- The `200` ack still happens before any `await dispatchPromise`.
- Unhandled rejections still surface to `onUnhandledHandlerError`
  (default `console.error`).
- The verify-handshake path (GET) is unchanged — no async work
  to extend.

### Docs

- `docs/sdk/web.md` § "Vercel App Router" — show the wiring
  with `@vercel/functions.waitUntil`.
- `docs/sdk/web.md` § "Cloudflare Workers" — show `ctx.waitUntil`.
- `docs/compatibility.md` per-runtime matrix gains a "needs
  `waitUntil`" column.

## Impact

- **framework-adapters capability:** 1× MODIFIED requirement on
  the web adapter's threading contract.
- **Release impact:** `sdk-v0.9.0` (minor, additive).
- **Stability:** the new option is part of the v1 stability
  commitment.
- **Breaking?** No. Existing consumers that don't supply
  `waitUntil` see no behaviour change.
