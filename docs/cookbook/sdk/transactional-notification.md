# Transactional notification

Outbound-only flow: an external event (Stripe, Shopify, calendar
provider, internal job) fires a webhook into your app, and you push a
WhatsApp template to the customer. No inbound handling required —
delivery status updates are useful but optional.

## Why this shape

- The customer hasn't messaged you, so the **24-hour window is
  closed** by definition. Only approved templates flow.
- Templates of category `UTILITY` are the right fit (transactional, not
  marketing). Free for inbound-initiated UTILITY notifications under
  Meta's current pricing if you opt in; outbound UTILITY is paid but
  cheap.
- Pre-flight validation against the approved `TemplateDefinition`
  catches parameter-count drift before the HTTP round-trip.
- No `WindowTracker` needed on the client — `sendTemplate` is
  window-exempt.

## Code

```ts
import "dotenv/config";
import express, { type Request, type Response } from "express";
import { WhatsAppClient, type TemplateDefinition, TemplateError } from "@dojocoding/whatsapp";

const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
});

// Cache the approved definition. Refresh when a `template_status`
// webhook event fires (see two-way-support-with-handoff.md for the
// receiver wiring).
let cachedDef: TemplateDefinition | undefined;
async function getDef(): Promise<TemplateDefinition> {
  if (!cachedDef) cachedDef = await client.getTemplate(process.env.TEMPLATE_ID!);
  return cachedDef;
}

async function notifyOrderShipped(toWaId: string, orderNumber: string, carrier: string) {
  const def = await getDef();
  await client.sendTemplate({
    to: toWaId,
    name: def.name,
    language: def.language,
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: orderNumber },
          { type: "text", text: carrier },
        ],
      },
    ],
    validateAgainst: def, // throws TemplateError before HTTP if params don't match {{N}} count
  });
}

// Example: handle a Stripe webhook that fires when an order ships.
const app = express();
app.use(express.json());

app.post("/stripe/webhook", async (req: Request, res: Response) => {
  // ... verify Stripe signature here (out of scope for this recipe) ...
  const event = req.body;
  if (event.type === "charge.succeeded") {
    const { wa_id, order_number, carrier } = event.data.object.metadata ?? {};
    if (wa_id && order_number && carrier) {
      try {
        await notifyOrderShipped(wa_id, order_number, carrier);
      } catch (err) {
        if (err instanceof TemplateError) {
          // template-side mismatch — alert ops, don't retry
          console.error("[notify] template mismatch", err);
        } else {
          throw err; // RateLimitError already retried; AuthenticationError → rotate; etc.
        }
      }
    }
  }
  res.status(200).end();
});

app.listen(3000);
```

## Things that bite

- **Templates must be APPROVED in Meta Business Manager** before they
  send. Templates in `PENDING` / `REJECTED` / `PAUSED` will fail at
  Meta with a 132xxx error → `TemplateError` from the SDK. Watch the
  `template_status` webhook event so your cache invalidates on
  transitions.
- **`{{N}}` placeholders are 1-indexed.** Off-by-one against the
  `parameters` array is the #1 template bug. `validateAgainst` catches
  it pre-flight.
- **Don't reuse `wa_id`s across WABAs.** Customer ids are scoped to
  your business account; if you operate several, key your
  notification queue by `(wabaId, waId)`, not just `waId`.
- **The Stripe (or any source) signature still needs verifying** —
  this recipe omits it for brevity. Don't paste this into production
  without it.
- **`AUTHENTICATION` templates have stricter rules** (fixed body
  shape, OTP-only buttons). Use a `UTILITY` template for general
  transactional notifications; reserve `AUTHENTICATION` for actual
  one-time codes.

## Where to go from here

- **Receive delivery status updates.** Add a `WebhookReceiver` (no
  client wiring needed beyond the same App Secret + verify token) and
  register `receiver.on("status", e => ...)` to track which
  notifications were `sent` / `delivered` / `read` / `failed`. Surface
  failures to ops so retryable ones are queued.
- **Track template quality.** `receiver.on("template_quality", ...)`
  fires when a template's score moves between GREEN / YELLOW / RED;
  alert when YELLOW so you can edit the body before Meta auto-pauses.
- **Two-way:** if you want the customer to be able to _reply_ to the
  notification (and have you handle it), see
  [Two-way support with handoff](./two-way-support-with-handoff.md).
