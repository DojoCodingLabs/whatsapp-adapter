# Orchestrator process layout — one client, three callers

The plumbing recipe for a single orchestrator process that runs
**both packages** plus an LLM agent runtime plus a HITL inbox.
Use this when you're building a Front-Desk-style application
where the same Node process needs to:

- Receive inbound WhatsApp webhooks (your code, via SDK).
- Let an LLM agent draft and send replies (LLM, via MCP).
- Let a human operator take over and send manually (your code,
  via HITL inbox UI calling the SDK).
- Run deterministic outbound (cron reminders, transactional
  confirmations) on a schedule (your code, via SDK + queue).

The build-spec convention from
[`docs/when-to-use-which.md`](../../when-to-use-which.md):

> Use the SDK when **your code** is calling WhatsApp.
> Use the MCP server when **an LLM** is calling WhatsApp.

Same `WhatsAppClient` instance underneath either way.

## Process layout

```
                 ┌────────────────────────────────────────────────┐
                 │  Orchestrator process (one per WABA-phone pair)│
                 │                                                  │
   Meta webhook  │  Express                                         │
   POST  ─────▶  │  /webhooks/whatsapp  ─▶  WebhookReceiver         │
                 │                              │                   │
                 │                              ▼                   │
                 │                       windowTracker              │
                 │                       .notifyInbound(from)       │
                 │                              │                   │
                 │                              ▼                   │
                 │             ConversationStore (Postgres)         │
                 │             + agent.appendUserMessage(...)       │
                 │                              │                   │
                 │  ┌────────────────────────── │ ─────────────┐    │
                 │  │                           ▼              │    │
                 │  │   Claude Agent SDK runtime               │    │
                 │  │     ├─ tool: whatsapp_send_text   ──┐    │    │
                 │  │     ├─ resource: whatsapp://window  │    │    │
                 │  │     └─ prompt: /wa-template-send    │    │    │
                 │  └─────────────────────────────────────┼────┘    │
                 │                                        │         │
                 │     InMemoryTransport pair             │         │
                 │     ┌─────────────────────────────┐    │         │
                 │     │ WhatsAppMcpServer (embedded)│ ◀──┘         │
                 │     └──────────────┬──────────────┘              │
                 │                    │                             │
                 │  ┌─ HITL inbox UI ─┼─ Cron worker ──┐            │
                 │  │  /api/.../send  │  scheduledSend │            │
                 │  └────────┬────────┴────────┬───────┘            │
                 │           │                 │                    │
                 │           ▼                 ▼                    │
                 │  ┌──────────────────────────────────────┐        │
                 │  │  WhatsAppClient (one instance)        │ ──────┼──▶ Meta Graph API
                 │  │  • outbound HTTP                      │        │
                 │  │  • window tracker reference           │        │
                 │  │  • OTel spans on every call           │        │
                 │  │  • rate-limit queue (per-pair + WABA) │        │
                 │  └──────────────────────────────────────┘        │
                 └────────────────────────────────────────────────┘
```

Three caller paths converge on one `WhatsAppClient`:

1. **MCP server** — agent-driven outbound. The Claude Agent SDK
   calls a `whatsapp_send_*` tool; the MCP server's handler
   calls `client.sendX(...)`.
2. **HITL inbox API** — operator-driven outbound. The HITL UI
   POSTs `/api/conversations/:id/send`; the handler calls
   `client.sendX(...)` directly.
3. **Cron / business logic** — code-driven outbound. A
   `setInterval` / Bull queue / Tour Plan webhook handler /
   `@dojocoding/outbound` send-queue worker calls
   `client.sendX(...)` directly.

All three flow through the same client → same window tracker →
same dedupe → same OTel spans → same rate-limit queue.

## Scaffold

```ts
// orchestrator/src/index.ts
import express from "express";
import { WhatsAppClient, WebhookReceiver, WindowTracker } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp-sdk/express";
import { createPostgresStorage } from "@dojocoding/whatsapp-sdk/storage/postgres";
import { WhatsAppMcpServer } from "@dojocoding/whatsapp-mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Pool } from "pg";

// ─── 1. ONE STORAGE backend, shared across window + dedupe ─────────────────
const pg = new Pool({ connectionString: process.env.DATABASE_URL });
const storage = createPostgresStorage(pg);

// ─── 2. ONE WhatsAppClient instance ────────────────────────────────────────
const windowTracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage,
});

const waClient = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  windowTracker,
});

// ─── 3. Receiver for inbound (your code, SDK) ──────────────────────────────
const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  storage,
});

// ─── 4. MCP server embedded in-process, sharing the same client + tracker ──
const mcpServer = new WhatsAppMcpServer({
  client: waClient,
  wabaPhoneNumberId: waClient.phoneNumberId,
  windowTracker, // ← makes whatsapp://window/{phone} accurate to the agent
});

const [mcpServerEnd, mcpClientEnd] = InMemoryTransport.createLinkedPair();
await mcpServer.connect(mcpServerEnd);

// ─── 5. Agent runtime gets the MCP client end ──────────────────────────────
const agent = createAgent({
  mcpServers: { whatsapp: { transport: mcpClientEnd } },
  // + your other MCP servers (calendar, Tour Plan, knowledge, ...)
});

// ─── 6a. Caller path 1: MCP (agent-driven) — already wired above ──────────

// ─── 6b. Caller path 2: HITL inbox API (operator-driven) ───────────────────
const app = express();
app.use("/webhooks/whatsapp", createWhatsAppMiddleware({ receiver }));

app.post("/api/conversations/:id/send", async (req, res) => {
  // No LLM in the loop — operator approved the text in the inbox UI.
  await waClient.sendText({ to: req.body.to, body: req.body.body });
  res.sendStatus(200);
});

// ─── 6c. Caller path 3: deterministic outbound (cron / code-driven) ────────
setInterval(async () => {
  const reminders = await pg.query(`SELECT to_phone, template_params FROM due_reminders LIMIT 50`);
  for (const r of reminders.rows) {
    await waClient.sendTemplate({
      to: r.to_phone,
      name: "tour_reminder_v1",
      language: "es_MX",
      components: r.template_params,
    });
  }
}, 60_000);

// ─── 7. Wire inbound → agent (the hybrid loop) ─────────────────────────────
receiver.on("message", async (event) => {
  await windowTracker.notifyInbound(event.from); // updates window state
  await agent.appendUserMessage(describe(event));
});

app.listen(3000);
```

Three things to notice in this scaffold:

1. **`waClient` is constructed once.** Every send — agent,
   operator, cron — references the same object. Window-tracker
   state, dedupe state, OTel span context all stay coherent.
2. **The MCP server takes the same `waClient` and the same
   `windowTracker`.** No copies. When the cron-driven send
   happens, the tracker is updated; the agent's next
   `whatsapp://window/{phone}` read reflects it.
3. **The HITL `/api/conversations/:id/send` route does not call
   the MCP server.** The operator made the decision; routing
   through an MCP transport would add latency, error-mapping
   overhead, and a transcript that no LLM is reading.

## Which caller path for which agent role

Concrete from the Horizontes proposal's eight agents:

| Agent role                 | Decides what to send                                                | Caller path                                                     |
| -------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| First-response generator   | LLM picks copy from lead context                                    | MCP                                                             |
| OTA price comparator       | LLM picks argument framing                                          | MCP                                                             |
| Package generator          | LLM builds doc + decides format                                     | MCP (send), separate pipeline (doc generation)                  |
| Lead classifier / router   | Code routes based on LLM classification result                      | **SDK** (auto-ack); LLM is a subroutine, doesn't touch WhatsApp |
| WhatsApp customer service  | LLM drives full conversation                                        | MCP                                                             |
| Operational brief to guide | Tour Plan webhook triggers; brief content is templated from booking | **SDK** (`@dojocoding/outbound` → SDK)                          |
| Supplier email triage      | (v2 — email deferred)                                               | (v2)                                                            |
| Hotel contract pre-reading | LLM extracts; code decides who to notify on what channel            | **SDK** for the notification                                    |

The MCP server earns its keep on roles 1, 2, 5 — every other
WhatsApp-touching role is faster, cheaper, and more
deterministic via SDK.

## Anti-patterns

### Don't construct a second `WhatsAppClient` for the agent

```ts
// 🚫 WRONG
const waClientForBusinessLogic = new WhatsAppClient({...});
const waClientForAgent = new WhatsAppClient({...}); // separate instance
const mcpServer = new WhatsAppMcpServer({ client: waClientForAgent, ... });
```

Two clients mean two window trackers (if you also doubled
those), two retry-queue states, two rate-limit accounts.
You'll burn through your per-pair budget faster, and the
agent's `whatsapp://window/{phone}` resource will report stale
state because _only_ the agent's tracker sees inbound the
business logic processed. Construct one client; share it.

### Don't route deterministic outbound through MCP

```ts
// 🚫 WRONG
async function sendCronReminder(to: string) {
  await mcpClient.callTool({
    name: "whatsapp_send_template",
    arguments: { to, name: "tour_reminder_v1", language: "es_MX" },
  });
}
```

This works but it's slower (MCP round-trip), the response is a
`structuredContent` you have to parse, errors come back as
`isError: true` instead of typed exceptions you can catch with
`instanceof`, and there's no LLM reading the recovery hints —
which is the only reason MCP's error shape exists.

```ts
// ✅ RIGHT
async function sendCronReminder(to: string) {
  try {
    await waClient.sendTemplate({ to, name: "tour_reminder_v1", language: "es_MX" });
  } catch (e) {
    if (e instanceof RateLimitError) /* requeue */ ;
    if (e instanceof TemplateError) /* log + page */ ;
    throw e;
  }
}
```

### Don't put cross-cutting policy _inside_ the MCP server

If you need a consent gate on agent-driven marketing sends,
wrap the `WhatsAppClient` in a `WhatsAppLikeClient` shim that
gates marketing categories and hand the shim to
`WhatsAppMcpServer`. Cron sends through the real `waClient`
bypass the gate (because cron is your code; you've already
applied the policy).

See [`compliance-broadcast.md`](./compliance-broadcast.md) for
the consent-gate instance of this pattern.

## See also

- [`when-to-use-which.md`](../../when-to-use-which.md) — the
  per-call decision tree this recipe is the plumbing for.
- [`agent-handoff-loop.md`](./agent-handoff-loop.md) — the full
  inbound → agent-decision → outbound loop with conversation
  state.
- [`compliance-broadcast.md`](./compliance-broadcast.md) — the
  cross-cutting-policy pattern (consent gating).
- [`../../sdk/queue.md`](../../sdk/queue.md) — rate-limited queue
  for the deterministic outbound path.
- [`../../mcp/auth.md`](../../mcp/auth.md) — programmatic
  embedding section explicitly covers the
  `BuildServerInput.client` interface that makes the
  one-client-multiple-callers pattern work.
