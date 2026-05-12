# Design — `waitUntil` integration

## Context

The web adapter currently does fire-and-forget async dispatch:

```ts
result.dispatchPromise.catch(onUnhandledHandlerError);
return new Response(null, { status: 200 });
```

This is correct on Node / Bun / Deno standalone servers — the
promise lives in the event loop after the `Response` is
returned, and handlers complete asynchronously.

It's **silently broken** on Vercel serverless and Cloudflare
Workers. Both runtimes kill the function the instant the
`Response` returns. The `.catch(...)` registers a rejection
handler but the promise itself never resolves — no handlers
run, no DB writes happen, no OTel spans flush.

The fix is well-trodden ground in serverless: the runtime
provides a `waitUntil(promise)` API that registers a Promise
to be awaited AFTER the response, within the function's
lifecycle budget. The SDK doesn't have access to the runtime's
`waitUntil` directly — it has no idea whether it's running on
Vercel / Workers / Node — so we expose it as an option the
consumer passes in.

## Goals

- Make async dispatch reliable on Vercel + Cloudflare Workers
  without changing behaviour on Node / Bun / Deno.
- Keep the option simple: one callback, no runtime detection.
- Surface unhandled handler errors through the same hook as
  today (`onUnhandledHandlerError`).

## Non-Goals

- **Auto-detect runtime.** The adapter doesn't try to detect
  whether `waitUntil` is needed; consumers explicitly pass it.
  Auto-detection is brittle and the cost of being explicit is
  one line.
- **Multi-promise tracking.** `waitUntil` takes one promise
  per call. The adapter passes exactly one (`dispatchPromise`).
  Consumers wanting to track multiple side-effects can wrap
  their handler logic in `Promise.all` — that's their concern.
- **Timeout enforcement.** If `dispatchPromise` outlives the
  function's max duration, the runtime kills it. The adapter
  doesn't try to enforce its own timeout.

## Decisions

### 1. Why a callback, not a `runtime` enum

Two shapes considered:

- (a) `waitUntil: (promise) => void`
- (b) `runtime: "vercel" | "cloudflare" | "node"`

Picked (a). Reasons:
- Vercel's `waitUntil` API location changes between Edge and
  Node runtimes; an enum would either lie or proliferate
  values.
- The callback is what every serverless runtime hands you in
  some form. Letting the consumer wire their own `waitUntil`
  is one line and matches what they'd do anyway.
- Doesn't lock the SDK to a particular runtime's API contract
  — if Vercel changes their `waitUntil` shape in v2, consumers
  adapt without an SDK release.

### 2. Wrap with `.catch` BEFORE passing to `waitUntil`

The dispatch promise rejects when a handler throws. If we pass
the raw promise to `waitUntil`, the runtime sees an unhandled
rejection. Bad.

So we pass `dispatchPromise.catch(onUnhandledHandlerError)` —
the rejection is consumed by the error hook, and `waitUntil`
sees a promise that always resolves. Matches the current
fire-and-forget shape's behaviour.

### 3. Don't add `waitUntil` to the Express / Hono adapters

The Express adapter is a thin shim over the web adapter and
runs on Node, where fire-and-forget already works. The Hono
adapter's threading model depends on the Hono runtime (Node,
Workers, Bun, ...). When a Hono consumer runs on Workers, they
get a `c.executionCtx.waitUntil`; they can pass that into the
Hono adapter's options if we add the same option there. Out of
scope for this change — only ships on the web adapter now;
Hono can mirror in a follow-up if needed.

### 4. No change to the GET branch

The verify-handshake path (`GET /webhooks/whatsapp?...`) does
synchronous work only — there's no async dispatch to extend.
The `waitUntil` option is ignored on GET. Documented as such
but not enforced via runtime check; passing `waitUntil` on a
GET-only deployment is harmless.

### 5. Backwards compatibility

The option is optional. When omitted, the adapter keeps
calling `dispatchPromise.catch(onUnhandledHandlerError)` and
returning the response — byte-identical to today. Existing
consumers see zero diff.

### 6. Future: explicit timeout warning

A potential follow-up is to log a stderr warning when a
dispatch promise outlives a heuristic timeout (e.g. 60 s). Not
in scope; would need a real metrics story first.
