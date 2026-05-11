# Compliance-gated broadcast

WhatsApp marketing templates require **prior consent** from each
recipient. Meta's policy: customers must opt in via a documented
flow before you can send marketing content; opt-outs must be
honoured. Violating this gets your WABA suspended.

When an LLM agent is the one triggering broadcasts, you can't
rely on the agent to honour consent — agents hallucinate,
operators ask agents to "blast everyone", and consent state
isn't part of the model's context. **You enforce consent
server-side, between the MCP tool call and the actual send.**

This recipe shows how.

## Architecture

```
   Agent (MCP) ─▶ Express middleware ─▶ WhatsAppClient ─▶ Meta
                       │
                       │ (intercepts every send)
                       ▼
              consent ledger (Postgres / Redis / your CRM)
                       │
                  approved? → through
                  denied?   → MCP tool returns isError
```

The agent sees a normal MCP tool surface. Under the hood, every
send goes through a wrapper that checks consent. Denied sends
come back as `isError: true` with an actionable hint — the
agent can read it and either ask the user for permission or
choose a different recipient.

## Step 1 — model consent

Whatever your storage is, the contract for the consent ledger
is small:

```ts
interface ConsentLedger {
  /** True if `phone` has opted in to `category` messages. */
  isAllowed(phone: string, category: "marketing" | "utility" | "authentication"): Promise<boolean>;
  /** Record an explicit opt-in (e.g. from a webform, an in-app toggle). */
  optIn(phone: string, category: "marketing" | "utility" | "authentication"): Promise<void>;
  /** Record an opt-out — e.g. when the customer replies STOP. */
  optOut(phone: string, category: "marketing" | "utility" | "authentication"): Promise<void>;
}
```

A minimal Postgres-backed implementation:

```sql
CREATE TABLE wa_consent (
  phone TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('opt_in', 'opt_out')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, category)
);
```

```ts
async function isAllowed(phone: string, category: string): Promise<boolean> {
  const r = await pg.query(`SELECT status FROM wa_consent WHERE phone = $1 AND category = $2`, [
    phone,
    category,
  ]);
  return r.rows[0]?.status === "opt_in";
}
```

The schema and storage backend are your choice — the point is
that the ledger is **authoritative server state**, not something
the agent can read or override.

## Step 2 — wrap the WhatsAppClient

The agent talks to the SDK through `WhatsAppMcpServer`. Rather
than letting the agent talk to a bare `WhatsAppClient`, wrap the
client with a consent-gating shim that intercepts marketing-style
sends:

```ts
import {
  TemplateError,
  WhatsAppClient,
  type WhatsAppLikeClient,
  type BuildTemplateInput,
  type MessageSendResponse,
  type RequestOptions,
} from "@dojocoding/whatsapp-sdk";

class ConsentGatedClient implements WhatsAppLikeClient {
  constructor(
    private readonly inner: WhatsAppClient,
    private readonly ledger: ConsentLedger
  ) {}

  public get phoneNumberId(): string {
    return this.inner.phoneNumberId;
  }
  public get wabaId(): string {
    return this.inner.wabaId;
  }
  public get graphApiVersion() {
    return this.inner.graphApiVersion;
  }

  // ... mirror every send method on WhatsAppLikeClient ...
  // The interesting ones below.

  public async sendTemplate(
    input: BuildTemplateInput,
    options?: RequestOptions
  ): Promise<MessageSendResponse> {
    // 1. Determine the category by looking up the template.
    //    Cache this in memory across calls — the category
    //    rarely changes.
    const category = await this.categoryFor(input.name);

    // 2. If this is a marketing send, check consent.
    if (category === "MARKETING") {
      const allowed = await this.ledger.isAllowed(input.to, "marketing");
      if (!allowed) {
        // Throw a TemplateError so the MCP server's error-mapper
        // surfaces a model-readable hint.
        throw new TemplateError(
          `Recipient ${input.to} has not opted in to marketing messages on this WABA. ` +
            `Cannot send marketing template '${input.name}'. ` +
            `Confirm with the operator that consent exists before retrying.`
        );
      }
    }

    return this.inner.sendTemplate(input, options);
  }

  public async sendCarouselTemplate(...args: any[]) {
    /* same gating */
  }
  public async sendAuthTemplate(...args: any[]) {
    /* category="authentication" gating */
  }
  // ... etc.

  public isWindowOpen(to: string) {
    return this.inner.isWindowOpen(to);
  }
  public listTemplates(...args: any[]) {
    return this.inner.listTemplates(...args);
  }
  public getTemplate(...args: any[]) {
    return this.inner.getTemplate(...args);
  }
  // ... mirror remaining methods.

  private async categoryFor(templateName: string): Promise<string> {
    // List templates once at startup, build a name → category
    // map, refresh hourly. The SDK's template registry isn't
    // category-aware out of the box, so this is a small cache
    // you maintain.
    return this.templateCategoryMap.get(templateName) ?? "UNKNOWN";
  }
}
```

Pass this wrapper into `WhatsAppMcpServer`:

```ts
const realClient = new WhatsAppClient({ ... });
const gatedClient = new ConsentGatedClient(realClient, ledger);

const mcpServer = new WhatsAppMcpServer({
  client: gatedClient,
  wabaPhoneNumberId: realClient.phoneNumberId,
});
```

The MCP server's `BuildServerInput.client` is typed
`WhatsAppLikeClient`, not the concrete `WhatsAppClient` class —
so the wrapper plugs in directly.

## Step 3 — propagate opt-outs from inbound

When a customer replies with STOP / UNSUBSCRIBE / similar, record
the opt-out in your ledger:

```ts
receiver.on("message", async (event) => {
  await windowTracker.notifyInbound(event.from);

  if (event.message.type === "text") {
    const body = event.message.text.trim().toLowerCase();
    if (["stop", "unsubscribe", "opt-out", "remove"].includes(body)) {
      await ledger.optOut(event.from, "marketing");
      await client.sendText({
        to: event.from,
        body: "You've been unsubscribed from marketing messages. Reply START to opt back in.",
      });
      return; // Don't pass to the agent.
    }
    if (body === "start") {
      await ledger.optIn(event.from, "marketing");
      await client.sendText({
        to: event.from,
        body: "You've been resubscribed. Reply STOP to unsubscribe.",
      });
      return;
    }
  }

  // ...rest of inbound routing.
});
```

Important: the opt-out reply uses the **un-gated**
`realClient.sendText`, not `gatedClient.sendText`. The
confirmation is a _utility_ message in response to a customer
action, not a marketing send — it doesn't need consent.

## Step 4 — what the agent sees

When the agent tries to send a marketing template to a
non-opted-in recipient:

```
agent: call whatsapp_send_template
       { to: "+5210000000001", name: "summer_sale", language: "en_US" }

server: returns {
  isError: true,
  content: [{ type: "text", text:
    "Template send failed: Recipient +5210000000001 has not opted in to
    marketing messages on this WABA. Cannot send marketing template
    'summer_sale'. Confirm with the operator that consent exists before
    retrying. Inspect the template with whatsapp_get_template to verify
    the variable count, language code, and approval status, then retry."
  }],
  structuredContent: {
    error: { code: "TEMPLATE", message: "..." }
  }
}
```

The recovery hint guides the agent to ask the operator for
explicit consent — the agent shouldn't retry the same call.

## Step 5 — UX in the agent's system prompt

For best results, mention the consent layer in the agent's
system prompt:

```
You can send WhatsApp messages via the whatsapp_* tools. For marketing
templates, there's a server-side consent gate — if you get back
TEMPLATE / "has not opted in to marketing", do NOT retry. Instead, ask
me to confirm consent explicitly. I'll handle the opt-in flow out-of-band.
```

This is the same pattern Meta uses in their own docs: the
runtime enforces; the agent's system prompt makes the rule
legible.

## Why not gate inside the MCP server?

It's tempting to put consent enforcement in the tool handler
inside `@dojocoding/whatsapp-mcp`. We deliberately don't, for
two reasons:

1. **Separation of concerns.** Consent is a business rule, not
   a WhatsApp Cloud API rule. The SDK and the MCP server stay
   policy-neutral; consumers add policy via wrappers.
2. **Pluggability.** Different consumers have different consent
   models. Some use a CRM column, some a separate ledger, some
   a 3rd-party CDP. Hard-coding any of those into the MCP
   server would force everyone to migrate.

The `WhatsAppLikeClient` interface is the contract; the
consent-gated client is one wrapper; you could equally write a
rate-limit-gated client, an audit-logging client, etc.

## See also

- [`agent-handoff-loop.md`](./agent-handoff-loop.md) — the
  underlying agent ↔ customer loop.
- [`docs/compliance.md`](../../compliance.md) — Meta's policy
  rules in detail (what the SDK enforces vs what's your
  responsibility).
- [`docs/sdk/storage.md`](../../sdk/storage.md) — the SDK's
  `Storage` interface (a fine backing store for your consent
  ledger too, if you want to share infra).
