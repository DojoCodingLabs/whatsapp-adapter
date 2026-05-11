# Mock mode (`mock-mode`)

`MockWhatsAppClient` is an in-memory implementation of the same public
interface (`WhatsAppLikeClient`) as the real `WhatsAppClient`. It records
every send, generates deterministic `wamid.mock-N` ids, and never touches
the network — making it the right default for unit tests, contract tests,
local development, and CI without Meta credentials.

Spec: [`openspec/specs/mock-mode/spec.md`](../openspec/specs/mock-mode/spec.md).
Source: [`src/mock/`](../src/mock/).

## Public exports

```ts
import {
  MockWhatsAppClient,
  pickWhatsAppClient,
  type MockWhatsAppClientOptions,
  type PickWhatsAppClientOptions,
  type RecordedSend,
  type WhatsAppLikeClient,
} from "@dojocoding/whatsapp";
```

## Construction

```ts
const mock = new MockWhatsAppClient({
  phoneNumberId: "PHONE_ID",
  wabaId: "WABA_ID",
  // graphApiVersion: "v25.0", // optional — for symmetry with the real client
  // windowTracker: tracker,    // optional — same gate as the real client
  // now: () => Date.now(),     // optional — clock injection
});
```

Unlike the real client, `MockWhatsAppClient` does NOT require a token or
app secret — it has no HTTP boundary to authenticate.

## Sending

The 12 `send*` methods (`sendText`, `sendImage`, `sendVideo`, `sendAudio`,
`sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`,
`sendInteractive`, `sendTemplate`, `sendReaction`, `sendReply`) all
return the same `MessageSendResponse` shape as the real client:

```ts
await mock.sendText({ to: "521234567890", body: "hi" });
// {
//   messaging_product: "whatsapp",
//   contacts: [{ input: "521234567890", wa_id: "521234567890" }],
//   messages: [{ id: "wamid.mock-1" }]
// }
```

The `wamid` counter increments per send (per instance):

```ts
await mock.sendText({ to, body: "1" }); // wamid.mock-1
await mock.sendText({ to, body: "2" }); // wamid.mock-2
mock.reset();
await mock.sendText({ to, body: "3" }); // wamid.mock-1
```

## Inspecting recorded sends

```ts
mock.sentMessages;
// → ReadonlyArray<RecordedSend>
//   = [{ wamid, payload, sentAt }, …]
```

`payload` is the exact built `WhatsAppMessage` — assert against it:

```ts
const sends = mock.sentMessages;
expect(sends).toHaveLength(1);
expect(sends[0].payload.type).toBe("text");
expect((sends[0].payload as TextMessage).text.body).toBe("hi");
```

`mock.reset()` clears `sentMessages` and resets the counter to 1.

## Window gating in tests

If you pass a `windowTracker` to the mock, it honours the same
`WindowClosedError` rule as the real client:

```ts
const tracker = new WindowTracker({ phoneNumberId: "P", storage: new InMemoryStorage() });
const mock = new MockWhatsAppClient({ phoneNumberId: "P", wabaId: "W", windowTracker: tracker });

await expect(mock.sendText({ to: "X", body: "hi" })).rejects.toBeInstanceOf(WindowClosedError);

await tracker.notifyInbound("X");
await mock.sendText({ to: "X", body: "hi" }); // ok now
```

Templates and reactions remain window-exempt in the mock too.

## Simulating inbound webhooks

`mock.simulateInbound(receiver, event)` injects a synthetic event into a
`WebhookReceiver`, bypassing signature verification (you don't have to
compute HMACs in tests):

```ts
const receiver = new WebhookReceiver({ appSecret: "ignored", verifyToken: "ignored" });
const handler = vi.fn();
receiver.on("message", handler);

await mock.simulateInbound(receiver, {
  kind: "message",
  wabaId: "W",
  timestamp: Date.now(),
  id: "wamid.test-1",
  from: "521234567890",
  type: "text",
  body: { text: { body: "hi" } },
});

expect(handler).toHaveBeenCalledOnce();
```

This goes straight into `receiver._dispatchEvents([event])`, so dedupe
and span tagging still apply.

## `pickWhatsAppClient(options)`

The factory that returns the right backend based on
`process.env.WHATSAPP_MODE`:

```ts
import { pickWhatsAppClient } from "@dojocoding/whatsapp";

const client = pickWhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN ?? "", // unused in mock mode
  appSecret: process.env.WHATSAPP_APP_SECRET ?? "", // unused in mock mode
  // forceMock: true,    // override env detection
  // forceReal: true,    // override env detection (also overrides forceMock)
});
```

Resolution order:

1. `forceMock: true` → mock
2. `forceReal: true` → real
3. `process.env.WHATSAPP_MODE === "mock"` → mock
4. otherwise → real

The return type is `WhatsAppLikeClient`, the union both implementations
satisfy. Consumer code can take this type and run uniformly:

```ts
function postWelcome(client: WhatsAppLikeClient, to: string) {
  return client.sendTemplate({ to, name: "welcome", language: "en_US" });
}
```

## Parity guarantees

The `test/parity/` suite asserts that mock and real produce equivalent
observable behaviour for every send method and every webhook event kind.
If you add a method or rule to one, the parity tests will fail until the
other matches.

What's parity-tested:

- All 12 `send*` methods produce equivalent built payloads.
- Window gating fires `WindowClosedError` in both.
- Inbound dispatch invokes handlers identically.
- `wamid` shape conforms (`messages[0].id` is a string).

## Template registry

Pass an optional `templates` array to seed an in-memory registry that
`listTemplates(query?)` and `getTemplate(id)` consult:

```ts
import type { TemplateDefinition } from "@dojocoding/whatsapp";

const seeds: TemplateDefinition[] = [
  {
    id: "T1",
    name: "appt_reminder",
    language: "en_US",
    category: "UTILITY",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hi {{1}}, your appt is at {{2}}" }],
  },
];

const mock = new MockWhatsAppClient({
  phoneNumberId: "P",
  wabaId: "W",
  templates: seeds,
});

const def = await mock.getTemplate("T1");
await mock.sendTemplate({
  to: "521234567890",
  name: def.name,
  language: def.language,
  components: [
    {
      type: "body",
      parameters: [
        { type: "text", text: "Dani" },
        { type: "text", text: "10am" },
      ],
    },
  ],
  validateAgainst: def,
});
```

`listTemplates(query?)` filters in memory by `query.name`, `query.language`,
`query.status`, `query.category` (string equality), and respects
`query.limit`. Cursor pagination (`after` / `before`) is accepted on the
type signature but not honoured; tests that need cursor behaviour should
construct multiple mock instances with different seeds.

When `templates` is omitted, the mock preserves its v1 behaviour:
`listTemplates()` → `{ data: [] }` and `getTemplate(id)` rejects with
`TemplateError`. This is the documented exception to mock/real parity —
see [`compliance.md` § 3.5](./compliance.md#35-mockwhatsappclient-template-parity--registry-now-seedable-).

If you only need a per-test definition (and don't want to pre-seed),
`vi.spyOn` still works as before:

```ts
import { vi } from "vitest";

vi.spyOn(mock, "getTemplate").mockResolvedValue({
  id: "T",
  name: "appt",
  language: "en_US",
  category: "UTILITY",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Hi {{1}}" }],
});
```

## Gotchas

- **`pickWhatsAppClient` returns `WhatsAppLikeClient`, not the concrete
  class.** That's the point. If you need access to mock-only methods
  (`sentMessages`, `reset`, `simulateInbound`), construct
  `MockWhatsAppClient` directly or narrow with `instanceof`.
- **`WHATSAPP_MODE=mock` is the only env value that triggers mock
  mode.** `WHATSAPP_MODE=true` / `WHATSAPP_MODE=1` / etc. all return the
  real client. Mistype = real network call.
- **The mock doesn't validate credentials.** You can pass empty strings
  for token / appSecret in mock mode without `MissingCredentialsError`
  firing — the mock factory drops those fields. The real client still
  enforces them.
- **`now()` injection is for deterministic timestamps** in
  `RecordedSend.sentAt`. Use it when asserting on time-ordering.
