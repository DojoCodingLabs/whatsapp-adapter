# Cookbook — Mock-mode in Vitest

Replace hand-written `WhatsAppClient` mocks in your Vitest suite
with the SDK's first-class `MockWhatsAppClient`. The mock shares
the `WhatsAppLikeClient` interface with the real client (drift-
detected at our CI), so you get the same surface, the same
typed errors, deterministic `wamid.mock-N` returns — and a
single env var to flip your whole pipeline between real and
mock.

## The factory: `pickWhatsAppClient`

```ts
import { pickWhatsAppClient } from "@dojocoding/whatsapp-sdk";

const client = pickWhatsAppClient({
  phoneNumberId,
  wabaId,
  token,
  appSecret,
});
```

Returns a real `WhatsAppClient` by default. Honors:

- `forceMock: true` → returns `MockWhatsAppClient`.
- `forceReal: true` → returns `WhatsAppClient`.
- Falls back to `process.env.WHATSAPP_MODE` (`"mock"` /
  `"real"` / unset → real).

Both halves of the union satisfy `WhatsAppLikeClient`, so your
agent code, queue workers, and tests consume them
interchangeably.

## Pattern 1 — `WHATSAPP_MODE=mock` env var in Vitest

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      WHATSAPP_MODE: "mock",
      WHATSAPP_ACCESS_TOKEN: "dev-only-not-used",
      WHATSAPP_PHONE_NUMBER_ID: "dev-only-not-used",
      WHATSAPP_BUSINESS_ACCOUNT_ID: "dev-only-not-used",
    },
  },
});
```

Now every `pickWhatsAppClient(...)` call in your tests resolves
to `MockWhatsAppClient`. Your production code path is exercised
end-to-end — no `vi.mock(...)` hooks, no manual stubs.

## Pattern 2 — Per-test override (mixed real + mock)

For tests that need to assert on side-effects against the mock
but live alongside other suites that hit a real test WABA:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";

import { sendBookingConfirmation } from "../src/booking.js";

describe("sendBookingConfirmation", () => {
  let mock: MockWhatsAppClient;

  beforeEach(() => {
    mock = new MockWhatsAppClient({
      phoneNumberId: "PNID",
      wabaId: "WABA",
    });
  });

  afterEach(() => {
    mock.reset();
  });

  it("sends the customer a confirmation text", async () => {
    await sendBookingConfirmation(mock, {
      jobId: "job-1",
      to: "+5210000000001",
      slot: "Friday 3pm",
    });

    expect(mock.sent).toHaveLength(1);
    const [first] = mock.sent;
    expect(first?.payload.type).toBe("text");
    expect(first?.payload.to).toBe("+5210000000001");
    expect(first?.wamid).toMatch(/^wamid\.mock-\d+$/);
  });
});
```

`mock.sent` is a `ReadonlyArray<RecordedSend>` — every send the
mock has accepted, in order, with the full wire payload and the
synthetic wamid. `mock.reset()` clears it between tests.

## Pattern 3 — Window-gated tests

The mock has an optional `windowTracker` too — wire one when
your test exercises the window pre-flight:

```ts
import { InMemoryStorage, MockWhatsAppClient, WindowTracker } from "@dojocoding/whatsapp-sdk";

const tracker = new WindowTracker({
  storage: new InMemoryStorage(),
  phoneNumberId: "PNID",
});
const mock = new MockWhatsAppClient({
  phoneNumberId: "PNID",
  wabaId: "WABA",
  windowTracker: tracker,
});

await tracker.notifyInbound("+5210000000001"); // open the window

// Now the free-form send succeeds; without notifyInbound it'd throw WindowClosedError.
await mock.sendText({ to: "+5210000000001", body: "hi" });
```

## Pattern 4 — Seeded template registry

The mock's `listTemplates` / `getTemplate` return the templates
you seed at construction:

```ts
const mock = new MockWhatsAppClient({
  phoneNumberId: "PNID",
  wabaId: "WABA",
  templates: [
    {
      id: "tpl-1",
      name: "hello_world",
      language: "en_US",
      category: "UTILITY",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Hello {{1}}!" }],
    },
  ],
});

const list = await mock.listTemplates();
expect(list.data).toHaveLength(1);
```

When omitted, `listTemplates` returns `{ data: [] }` and
`getTemplate` rejects.

## Pattern 5 — `simulateInbound` for receiver tests

`MockWhatsAppClient` exposes a test-fixture helper for driving
synthetic inbound events into a paired `WebhookReceiver`:

```ts
mock.simulateInbound({
  kind: "message",
  id: "wamid.inbound-1",
  from: "+5210000000001",
  type: "text",
  body: { text: { body: "hi from the customer" } },
  wabaId: "WABA",
  timestamp: Date.now(),
});
```

The receiver fires registered handlers as if the event came
from a real webhook. Useful for testing your handler logic
without staging Meta's full POST round-trip.

## Don't

- **Don't `vi.mock("@dojocoding/whatsapp-sdk", ...)`.** Replace
  the import surface and you lose the SDK's typed errors and
  drift-detection guarantees. Use `pickWhatsAppClient` instead.
- **Don't share a `MockWhatsAppClient` instance across parallel
  tests.** Recorded sends accumulate; pair with `reset()` or
  construct per-test.
- **Don't assume the mock's `wamid` format is stable across
  major versions.** The current `^wamid\.mock-\d+$` shape is
  pinned through the 1.x line per `MIGRATION.md`, but
  match-test against the prefix, not the exact value.

## See also

- [`docs/sdk/mock.md`](../../sdk/mock.md) — full `MockWhatsAppClient` reference.
- [`docs/mcp/auth.md`](../../mcp/auth.md) § "Preview / mock mode" — the same `WHATSAPP_MODE=mock` flag exposed on the MCP bin.
- [`docs/cookbook/mcp/embedded-toolset.md`](../mcp/embedded-toolset.md) — embedding the MCP tools in your tests via `createWhatsAppToolset` with the mock as the client.
