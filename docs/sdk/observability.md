# Observability (`observability`)

OpenTelemetry spans on every Graph API call and every webhook handler
invocation. PII redaction on span attributes. No-op when no global tracer
provider is registered.

Spec: [`openspec/specs/observability/spec.md`](../openspec/specs/observability/spec.md).
Source: [`src/observability/`](../src/observability/).

## Public exports

```ts
import { withSpan, getTracer, hashPhoneNumberId, setRedactSalt } from "@dojocoding/whatsapp";
```

`@opentelemetry/api` is a peer dependency (declared `optional`). The SDK
imports it directly; if you don't install it, the SDK won't load. If you
do install it but never register a `TracerProvider`, the OTel API returns
a no-op tracer and the SDK's spans are silent — no errors, no overhead
beyond a function call.

## What gets instrumented

The SDK emits two span types out of the box:

### `whatsapp.request`

Wraps every Graph API call (`POST /messages`, `GET /message_templates`,
etc.). Attributes:

| Attribute                  | Type   | Notes                                                               |
| -------------------------- | ------ | ------------------------------------------------------------------- |
| `whatsapp.method`          | string | HTTP method (`POST`, `GET`, …)                                      |
| `whatsapp.path`            | string | Path with leading slash, no version prefix                          |
| `whatsapp.phone_number_id` | string | **Hashed** via `hashPhoneNumberId`                                  |
| `whatsapp.idempotency_key` | string | The `X-Dojo-Idempotency-Key` UUID v4                                |
| `whatsapp.error.code`      | string | On failure: `RATE_LIMIT`, `WINDOW_CLOSED`, `TEMPLATE`, `UNKNOWN`, … |
| `whatsapp.error.meta_code` | number | On `RateLimitError`: the Meta error code (e.g. 131056)              |

Span status: `OK` on success, `ERROR` on the typed-error throw.

### `whatsapp.webhook.dispatch`

Wraps every handler invocation inside `WebhookReceiver._dispatch`.
Attributes:

| Attribute                  | Type   | Notes                                                                |
| -------------------------- | ------ | -------------------------------------------------------------------- |
| `whatsapp.event.kind`      | string | `message`, `status`, `template_status`, …                            |
| `whatsapp.waba_id`         | string | **Hashed**                                                           |
| `whatsapp.phone_number_id` | string | **Hashed**; only present if the event carried one                    |
| `whatsapp.event.id`        | string | For `message` / `status` only — the wamid (NOT hashed; it isn't PII) |

Handler exceptions surface as a recorded `exception` event on the span,
plus `status.code === ERROR`.

## `withSpan(name, fn, attributes?)`

The wrapper used by both built-in span types. Use it for your own
WhatsApp-related operations to keep correlation:

```ts
import { withSpan } from "@dojocoding/whatsapp";

await withSpan(
  "frontdesk.classify_intent",
  async () => {
    // … your async work
  },
  { "frontdesk.tenant_id": tenantId }
);
```

It applies the attributes at start, records exceptions, sets the span's
status to `ERROR` on rejection, and ends the span exactly once.

## PII redaction

`phone_number_id` and `waba_id` would be sensitive if dumped into traces —
even though they're not user phone numbers, they identify the business.
The SDK never tags them raw. Use `hashPhoneNumberId(value)` for any
custom span attribute that includes one:

```ts
import { hashPhoneNumberId } from "@dojocoding/whatsapp";

withSpan("custom.op", async () => { … }, {
  "whatsapp.phone_number_id": hashPhoneNumberId(phoneNumberId),
});
```

The hash is `sha256(salt + ":" + value)` truncated to the first 16 hex
chars. It's deterministic for stable correlation within an environment.

### Setting the redact salt

```ts
import { setRedactSalt } from "@dojocoding/whatsapp";

setRedactSalt(process.env.WHATSAPP_REDACT_SALT ?? "@dojo:default");
```

Call this **once at boot**. The default salt
(`@dojocoding/whatsapp:dev-default-salt`) is fine for development but
shouldn't be used in production — different environments would otherwise
produce identical hashes for the same input, defeating env isolation in
trace correlation.

Setting the salt in production also avoids leaking which environment
shares span attributes with which other environment if both export to
the same observability backend.

## Wiring an exporter

The SDK doesn't ship an exporter — that's your call (Tempo, Honeycomb,
Datadog, OTLP, console, …). Minimal Node setup with the OTLP HTTP
exporter:

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "frontdesk",
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.GIT_SHA ?? "dev",
  }),
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
});

sdk.start();
process.on("SIGTERM", () => sdk.shutdown());
```

Once the provider is registered, `whatsapp.request` and
`whatsapp.webhook.dispatch` spans show up in your traces automatically.

## Local debugging without an exporter

```ts
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
trace.setGlobalTracerProvider(provider);
```

Now every send / webhook dispatch logs a JSON span to stdout — useful for
verifying that attributes look right before integrating with a backend.

## Without OTel registered

The SDK keeps working. `withSpan` returns the result of `fn()` and the
no-op tracer drops everything. There's no error, no warning, no overhead
worth measuring. Production teams that don't run distributed tracing can
ignore this capability entirely.

## Gotchas

- **`hashPhoneNumberId` is salted but not encrypted.** The same
  `(salt, input)` pair always produces the same hash — that's the point
  for correlation. It is not a credential and not safe to use as one.
- **Set the salt before any spans are emitted.** Late changes don't
  retroactively re-hash already-exported spans.
- **The wamid is NOT hashed** in `whatsapp.webhook.dispatch`. It's an
  opaque message id, not PII (no Meta-side mapping back to a phone number
  is exposed). Keeping it raw is intentional so traces correlate with
  application-side message logs.
- **`@opentelemetry/api` is a peer dep.** If your app pulls in two
  different versions of `@opentelemetry/api`, span propagation can break
  silently. Pin to one version in your `package.json`.

## Spec scenarios worth knowing

From `openspec/specs/observability/spec.md`:

- A successful `withSpan(...)` produces exactly one span with status OK.
- A throwing `withSpan(...)` records an `exception` event and sets
  `status.code === ERROR`.
- `hashPhoneNumberId` is deterministic across calls and never includes
  any contiguous substring of the input ≥ 4 chars.
- `setRedactSalt` actually changes the hash output.
- `withSpan(...)` works with no provider registered (returns the value,
  no exception).
