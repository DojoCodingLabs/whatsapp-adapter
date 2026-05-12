## MODIFIED Requirements

### Requirement: 200 ack returned before handlers run

The web adapter (`@dojocoding/whatsapp-sdk/web`) SHALL ack
Meta's webhook with `200 OK` before awaiting registered
handlers. Handler execution SHALL run asynchronously after the
response is returned.

The adapter SHALL accept an optional `waitUntil` callback in
`CreateWhatsAppHandlerOptions`:

```ts
interface CreateWhatsAppHandlerOptions {
  onUnhandledHandlerError?: (err: unknown) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
}
```

When `waitUntil` is supplied, the adapter SHALL pass the
dispatch promise (already chained with `.catch(onUnhandledHandlerError)`
so it always resolves) to `waitUntil`. This ensures the
async dispatch survives the response on runtimes that kill
function invocations after the response (Vercel serverless,
Cloudflare Workers).

When `waitUntil` is omitted, the adapter SHALL register the
error handler via `.catch(onUnhandledHandlerError)` and let
the promise execute in the event loop ("fire and forget").
This preserves the original behaviour for long-lived runtimes
(Node, Bun standalone, Deno standalone).

The `waitUntil` callback SHALL NOT be invoked on the verify
handshake (GET) path — there is no async dispatch to extend.

#### Scenario: `waitUntil` extends async dispatch on a happy path

- **GIVEN** a `createWhatsAppHandler(receiver, { waitUntil })`
  with a recorded `waitUntil` mock
- **WHEN** a valid signed POST is received and a registered
  handler runs successfully
- **THEN** `waitUntil` SHALL be called exactly once
- **AND** the promise passed to `waitUntil` SHALL resolve

#### Scenario: `waitUntil` consumes handler errors

- **GIVEN** a `createWhatsAppHandler(receiver, { waitUntil, onUnhandledHandlerError })`
- **WHEN** a valid signed POST is received and a registered
  handler throws
- **THEN** `onUnhandledHandlerError` SHALL be called with the
  thrown error
- **AND** `waitUntil` SHALL be called exactly once, with a
  promise that resolves (NOT rejects)

#### Scenario: Omitting `waitUntil` preserves fire-and-forget behaviour

- **GIVEN** a `createWhatsAppHandler(receiver, {})` (no `waitUntil`)
- **WHEN** a valid signed POST is received
- **THEN** the response SHALL be `200`
- **AND** the dispatch promise SHALL be allowed to execute on
  the event loop
- **AND** unhandled handler errors SHALL still reach
  `onUnhandledHandlerError`

#### Scenario: `waitUntil` is not invoked on GET

- **GIVEN** a `createWhatsAppHandler(receiver, { waitUntil })`
- **WHEN** a GET `?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`
  is received
- **THEN** the response SHALL be the verify-handshake result
  (200 with the challenge, or 403)
- **AND** `waitUntil` SHALL NOT be called
