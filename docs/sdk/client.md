# Client (`cloud-api-client`)

The HTTP boundary to `graph.facebook.com`. `WhatsAppClient` owns
credentials, version pinning, retries, error mapping, and the convenience
`send*` / template / health-check methods.

Spec: [`openspec/specs/cloud-api-client/spec.md`](../openspec/specs/cloud-api-client/spec.md).
Source: [`src/client/`](../src/client/).

## Public exports

From the package root (`@dojocoding/whatsapp`):

```ts
import {
  WhatsAppClient,
  type WhatsAppClientOptions,
  type TokenInfo,
  type HttpMethod,
  type RequestOptions,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
  TransientHttpError,
  GRAPH_API_VERSION,
  META_GRAPH_BASE_URL,
  type GraphApiVersion,
} from "@dojocoding/whatsapp";
```

## Construction

```ts
const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  // Optional:
  // graphApiVersion: "v25.0",
  // windowTracker: tracker,
});
```

Required: `phoneNumberId`, `wabaId`, `token`, `appSecret`. Missing or empty
fields throw `MissingCredentialsError` synchronously — no I/O happens at
construction time.

The token is a **System User** or **BISU** (Business Integration System
User) bearer credential, provisioned in Meta Business Manager. The App
Secret is the secret of the Meta App that owns the WABA — it's used to
verify webhook HMACs (so the receiver and the client share it).

### `token` accepts a callback for rotation

`token` can be either a `string` or a `TokenProvider = () => string |
Promise<string>`. The SDK resolves the callback **once per outer
request** (all retry attempts within a single request reuse the
resolved value); the resolved string is the bearer credential for
that request only. The SDK does **not** cache across requests.

Use the callback when tokens rotate — System User token expiry,
manual rotation in Business Manager, or refresh after a 401. The
"swap the client instance per tenant" pattern documented in
[`patterns.md`](./patterns.md) § 5 is no longer necessary.

```ts
import { WhatsAppClient } from "@dojocoding/whatsapp";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  token: async () => mySecretManager.get("whatsapp-token"),
});
```

Provider error handling: throwing, returning `""`, or returning a
non-string surfaces as `AuthenticationError` **before** the HTTP
call. The underlying error is attached as `cause`.

## Sending messages

The client exposes one convenience method per outbound type. All of them
return the parsed `MessageSendResponse`:

```ts
type MessageSendResponse = {
  messaging_product: "whatsapp";
  contacts: ReadonlyArray<{ input: string; wa_id: string }>;
  messages: ReadonlyArray<{ id: string }>; // the wamid you'll see in webhooks
};
```

| Method                                                                 | Builder underneath | Window-gated?                               |
| ---------------------------------------------------------------------- | ------------------ | ------------------------------------------- |
| `sendText({ to, body, previewUrl?, replyTo? })`                        | `buildText`        | Yes                                         |
| `sendImage({ to, id?, link?, caption?, replyTo? })`                    | `buildImage`       | Yes                                         |
| `sendVideo({ to, id?, link?, caption?, replyTo? })`                    | `buildVideo`       | Yes                                         |
| `sendAudio({ to, id?, link?, replyTo? })`                              | `buildAudio`       | Yes                                         |
| `sendDocument({ to, id?, link?, caption?, filename?, replyTo? })`      | `buildDocument`    | Yes                                         |
| `sendSticker({ to, id?, link?, replyTo? })`                            | `buildSticker`     | Yes                                         |
| `sendLocation({ to, latitude, longitude, name?, address?, replyTo? })` | `buildLocation`    | Yes                                         |
| `sendContacts({ to, contacts, replyTo? })`                             | `buildContacts`    | Yes                                         |
| `sendInteractive({ to, kind: "button" \| "list" \| "cta_url", … })`    | `buildInteractive` | Yes                                         |
| `sendTemplate({ to, name, language, components?, validateAgainst? })`  | `buildTemplate`    | **No** (window-exempt)                      |
| `sendReaction({ to, messageId, emoji })`                               | `buildReaction`    | **No** (window-exempt)                      |
| `sendReply(replyTo, payload)`                                          | —                  | Yes for non-template, non-reaction payloads |

For builder details (validation rules, payload shapes), see
[`messages.md`](./messages.md).

### Happy path

```ts
const res = await client.sendText({
  to: "521234567890",
  body: "Hi! Your booking is confirmed.",
});
console.log(res.messages[0].id); // wamid.HBgMNTI...
```

### Window-closed gotcha

If you've configured a `WindowTracker` and the customer hasn't messaged
you in the last 24 hours, `sendText` throws **before** any HTTP call:

```ts
try {
  await client.sendText({ to: "521234567890", body: "Hi!" });
} catch (err) {
  if (err instanceof WindowClosedError) {
    await client.sendTemplate({
      to: "521234567890",
      name: "appointment_reminder",
      language: "en_US",
      components: [{ type: "body", parameters: [{ type: "text", text: "Dani" }] }],
    });
  }
}
```

`sendTemplate` and `sendReaction` are **window-exempt** by design —
templates are the escape hatch when the window is closed; reactions are
part of an existing thread.

## Retry policy

Every `client.request(...)` is wrapped in a retry loop. Defaults
(exported as `DEFAULT_RETRY_POLICY`):

```ts
{
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8000,
  jitter: "full",
  floorMs: 50,
}
```

The retry layer fires on:

- HTTP `408`, `429`, or any `5xx`
- Meta error codes `130429`, `131048`, `131056`, `131053`
- `AbortError`
- `TypeError: fetch failed` (network)

It does **not** retry on:

- HTTP 4xx other than `408` / `429`
- Meta codes outside the retryable set (e.g. `131026` window-closed,
  `132xxx` template errors)
- Synchronous validation errors thrown by the SDK itself
  (`MissingCredentialsError`, builder validation, etc.)

When Meta sends a `Retry-After` header (numeric seconds or HTTP-date), the
helper waits at least that long — capped to `maxDelayMs`.

### Per-call override

```ts
await client.sendText({ to, body }, { retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 } });
```

You can also pass `signal: AbortSignal` for cancellation, or
`graphApiVersion` to override the version on a single call (rare —
useful only for cross-version migrations).

## Error mapping

A non-2xx response with a parseable Meta error envelope becomes a typed
error:

| Meta code(s)                           | Typed class                   | Retried? |
| -------------------------------------- | ----------------------------- | -------- |
| `130429`, `131048`, `131056`, `131053` | `RateLimitError`              | Yes      |
| `131026`                               | `WindowClosedError`           | No       |
| `132000`–`132999`                      | `TemplateError`               | No       |
| `190` (carries `subcode`)              | `AuthenticationError`         | No       |
| `200`, `210`, `230`, `294`, `299`      | `PermissionError`             | No       |
| `100`                                  | `CapabilityError`             | No       |
| anything else / non-Meta-shaped body   | `WhatsAppError("UNKNOWN", …)` | No       |

For the recommended catch pattern, see
[`compliance.md` § 4](./compliance.md#4-error-code-coverage).

## Health check

```ts
const info = await client.healthCheck();
// {
//   valid: true,
//   expiresAt: 1735689600000,   // epoch ms; null for non-expiring tokens
//   appId:    "...",
//   userId:   "...",
//   scopes:   ["whatsapp_business_management", ...],
// }
```

`healthCheck()` calls `GET /debug_token?input_token=…`. It throws
`WhatsAppError` if Meta reports `is_valid: false`. Use it at boot or as a
liveness check for monitoring.

## Idempotency hint

Every `client.request()` call attaches `X-Dojo-Idempotency-Key: <uuid v4>`.
The same key is reused across retry attempts of the same logical call so
your internal logs can correlate retried writes.

**Meta does NOT honour this header.** It exists for client-side
correlation only — internal logs, parity replays in the mock, and any
future replay-buffering layer. A retry of `POST /messages` on Meta's side
creates a new send regardless of the key. See
[`compliance.md` § 3.4](./compliance.md#34-x-dojo-idempotency-key--design-clarified-no-code-change).

You can pass your own key via `RequestOptions.idempotencyKey` (rare —
useful when the call is part of a larger transaction whose id you want
to thread through):

```ts
await client.sendText({ to, body }, { idempotencyKey: "txn-12345" });
```

## Gotchas

- **Errors never leak the token.** `MissingCredentialsError` names the
  missing field but never includes the value of any credential, even when
  reporting another field as missing.
- **`graphApiVersion` is per-instance.** The constructor stores it; you
  can run two clients side-by-side on different versions for migration
  testing.
- **`request(...)` is `@internal`.** Public consumers should use the
  `send*` / template / health-check methods. The raw `request` is
  exported for capability-slice integration only.
- **Path normalisation** tolerates one leading slash. Both
  `/${phoneNumberId}/messages` and `${phoneNumberId}/messages` resolve to
  the same URL.
- **No automatic credential refresh.** When the token expires, calls
  start failing with code `190` (mapped to `WhatsAppError("UNKNOWN", ...)`
  with Meta's message attached). Rotate via Business Manager and
  re-instantiate the client.

## Spec scenarios worth knowing

Plucked from `openspec/specs/cloud-api-client/spec.md`:

- Empty `token` at construction → `MissingCredentialsError`, and the
  thrown error's serialisation does not contain the substring of any other
  credential.
- 503 on attempts 1–2, 200 on attempt 3 → resolves with the 200 body;
  total attempts === 3.
- 503 on every attempt → throws after exactly `maxAttempts` calls.
- Path without leading slash → no double slash in the URL.
- `Retry-After: 2` → next attempt waits ≥ 2000 ms.
- 4xx with code `131026` → throws `WindowClosedError` synchronously; no
  retry.

For the authoritative list, read the spec.
