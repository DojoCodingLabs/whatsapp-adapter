# Multi-tenant

One process, multiple tenants, each with its own WABA + phone number.
The SDK is built for this — zero global state, one client / receiver /
tracker per WABA-phone pair — but you have to wire it correctly.

Use cases:

- A SaaS / agency platform serving many businesses with their own
  numbers.
- An internal platform / toolkit deployed once with multiple client
  configurations side-by-side.
- A BSP (Business Solution Provider) onboarding multiple WABAs under a
  single operations team.
- Migrating from one WABA to another without dual-write outages.

## Why this shape

- **Per-tenant isolation by construction.** Two tenants on the same
  process never share `WhatsAppClient`, `WindowTracker`, or
  `WebhookReceiver` instances. There are no module-level singletons
  inside the SDK.
- **Shared `Storage` is fine** — `WindowTracker` keys its entries
  with `window:<phoneNumberId>:<customerWaId>` so two trackers on the
  same Redis instance don't collide. Same for `WebhookDeduper`
  (keys are scoped to the receiver instance via the wamid prefix).
- **One webhook URL per tenant** is the cleanest mount path (e.g.
  `/webhooks/whatsapp/:tenantId`). One URL for all tenants is also
  possible if you can identify the tenant from `entry[].id` (the
  `wabaId`), but per-tenant URLs are easier to debug.
- **PII redaction salt is per-environment**, not per-tenant — set
  `setRedactSalt(...)` once at boot.

## Code

```ts
import "dotenv/config";
import express, { type Router } from "express";
import {
  WhatsAppClient,
  WebhookReceiver,
  WindowTracker,
  InMemoryStorage,
  setRedactSalt,
  type Storage,
  type WhatsAppLikeClient,
  type WhatsAppEvent,
} from "@dojocoding/whatsapp";
import { createWhatsAppMiddleware } from "@dojocoding/whatsapp/express";

setRedactSalt(process.env.WHATSAPP_REDACT_SALT ?? "frontdesk:prod");

interface TenantConfig {
  tenantId: string; // your internal id
  phoneNumberId: string;
  wabaId: string;
  token: string;
  appSecret: string;
  verifyToken: string;
}

interface TenantHandle {
  config: TenantConfig;
  client: WhatsAppLikeClient;
  receiver: WebhookReceiver;
  tracker: WindowTracker;
}

// In production, load from your tenant store (Postgres, Vault, etc.).
function loadTenants(): TenantConfig[] {
  return [
    /* ... */
  ];
}

// One shared Storage for both window-tracker and dedupe state across
// all tenants. In production, swap InMemoryStorage for a Redis-backed
// implementation so multiple instances of this process see each
// other's state.
const sharedStorage: Storage = new InMemoryStorage();

const tenants = new Map<string, TenantHandle>();

function makeTenant(cfg: TenantConfig): TenantHandle {
  const tracker = new WindowTracker({
    phoneNumberId: cfg.phoneNumberId,
    storage: sharedStorage,
  });

  const client = new WhatsAppClient({
    phoneNumberId: cfg.phoneNumberId,
    wabaId: cfg.wabaId,
    token: cfg.token,
    appSecret: cfg.appSecret,
    windowTracker: tracker,
  });

  const receiver = new WebhookReceiver({
    appSecret: cfg.appSecret,
    verifyToken: cfg.verifyToken,
    storage: sharedStorage,
    onError: (err, event) => console.error("[receiver]", { tenantId: cfg.tenantId, err, event }),
  });

  // Wire the per-tenant message handler.
  receiver.on("message", async (e) => {
    await tracker.notifyInbound(e.from);
    await dispatchToTenant(cfg.tenantId, client, e);
  });

  return { config: cfg, client, receiver, tracker };
}

function buildApp(): express.Express {
  const app = express();

  for (const cfg of loadTenants()) {
    const tenant = makeTenant(cfg);
    tenants.set(cfg.tenantId, tenant);

    // Per-tenant mount path. Easy to debug; one cert chain still works.
    const mountPath = `/webhooks/whatsapp/${cfg.tenantId}`;
    const router: Router = createWhatsAppMiddleware(tenant.receiver, {
      onUnhandledHandlerError: (err) =>
        console.error("[whatsapp/express]", { tenantId: cfg.tenantId, err }),
    });
    app.use(mountPath, router);
  }

  return app;
}

async function dispatchToTenant(
  tenantId: string,
  client: WhatsAppLikeClient,
  event: WhatsAppEvent
) {
  // Your per-tenant business logic. Look up tenant config in your
  // store; pick the right Skills, brand voice, escalation rules, etc.
  // The point is: this is where tenancy diverges. The SDK above is
  // identical across tenants.
}

buildApp().listen(3000);
```

## Things that bite

- **Don't share a `WhatsAppClient` across tenants.** Tokens and App
  Secrets are per-WABA. One bearer token per tenant; wrong-token =
  401 forever.
- **Don't share a `WebhookReceiver` across tenants either.** App
  Secret is per-tenant; HMAC verification needs the tenant's own
  secret. The mount-path-per-tenant pattern makes this natural.
- **`WindowTracker` keys are scoped to `phoneNumberId`** so the
  shared `Storage` is safe. But if you accidentally reuse a tracker
  across different `phoneNumberId`s, keys collide silently.
  Constructor-bind one tracker per phone.
- **Verify-token rotation is per-tenant.** Update Meta's webhook UI
  for that tenant _and_ your config at the same instant. The
  middleware uses a constant-time compare so a partial rollout
  produces 403s, not signature noise.
- **Span attributes (`whatsapp.phone_number_id`, `whatsapp.waba_id`)
  are hashed with a single redact salt** across all tenants in the
  same environment. Two tenants get _different_ hashes (because the
  inputs differ); the salt is just for environment isolation. Don't
  set the salt per-tenant — that prevents cross-tenant trace
  correlation when needed (e.g. shared infra issue).
- **Loading tenants synchronously at boot is fine for dozens.** For
  thousands, lazy-instantiate on first webhook hit and cache. Don't
  forget to handle "new tenant added at runtime" without a restart.

## Where to go from here

- **Per-tenant Skills / brand voice.** The SDK doesn't speak about
  Skills (or any agent-framework concept beyond send / receive). Layer
  your agent framework — Claude Agent SDK Skills, LangChain agents,
  custom orchestrators — on top; pass the tenant id through your
  loader so the right Skills, brand voice, and escalation rules
  resolve per call.
- **Quota and billing per tenant.** Wrap each `client.send*` call in
  your meter (or use OTel span attributes to derive usage from the
  exporter side). The `whatsapp.path` and tenant-id-tagged spans are
  what you'd query.
- **Token rotation.** Tokens expire (especially BISU). Watch for
  `AuthenticationError` from any send and trigger your token-refresh
  workflow for _that tenant only_. See
  [`../patterns.md`](../patterns.md#5-token-rotation-on-authenticationerror).
- **One URL for all tenants.** Possible if Meta's webhook UI lets you
  point multiple WABAs at the same URL — the receiver picks the
  tenant by `entry[].id` (the `wabaId`). Per-tenant URLs are still
  easier to debug; pick this only when you have to.
