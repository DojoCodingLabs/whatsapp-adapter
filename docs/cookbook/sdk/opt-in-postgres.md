# Cookbook — Postgres-backed `OptInRegistry`

Persist consent state across processes + cold starts using a
Postgres table. Drop-in replacement for `InMemoryOptInRegistry`
— same interface, same gating semantics, durable storage.

The SDK doesn't ship this adapter. Consent shape varies too
much by deployment (audit retention, multi-tenant key
prefixing, integration with an external consent ledger) to
prescribe one. This recipe is the canonical pattern.

## Schema

```sql
-- migrations/001_opt_outs.sql
CREATE SCHEMA IF NOT EXISTS whatsapp;

-- An opt-out row blocks template sends. Category NULL = global.
CREATE TABLE whatsapp.opt_outs (
  recipient text NOT NULL,
  category text NULL, -- 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | NULL
  reason text NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipient, category)
);

CREATE INDEX opt_outs_recipient_idx ON whatsapp.opt_outs (recipient);

-- Optional audit table for opt-ins (compliance defensibility).
CREATE TABLE whatsapp.opt_ins (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  category text NULL,
  source text NULL,
  attributes jsonb NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opt_ins_recipient_idx ON whatsapp.opt_ins (recipient);
```

Note the PRIMARY KEY allows one row per (recipient, category)
pair. A global opt-out (`category IS NULL`) and a
category-scoped opt-out can both exist for the same recipient.

## Adapter

```ts
// lib/opt-in-postgres.ts
import type { OptInMeta, OptInQuery, OptInRegistry, OptOutOptions } from "@dojocoding/whatsapp-sdk";
import type { Pool } from "pg";

export class PostgresOptInRegistry implements OptInRegistry {
  constructor(private readonly pool: Pool) {}

  async isOptedIn(recipient: string, options?: OptInQuery): Promise<boolean> {
    // A global opt-out blocks every category query.
    const { rows: globalRows } = await this.pool.query(
      `SELECT 1 FROM whatsapp.opt_outs WHERE recipient = $1 AND category IS NULL LIMIT 1`,
      [recipient]
    );
    if (globalRows.length > 0) return false;

    // Category-scoped query: blocked only if that specific
    // category has been opted out.
    if (options?.category !== undefined) {
      const { rows: catRows } = await this.pool.query(
        `SELECT 1 FROM whatsapp.opt_outs WHERE recipient = $1 AND category = $2 LIMIT 1`,
        [recipient, options.category]
      );
      return catRows.length === 0;
    }

    // Unscoped query AND no global opt-out: soft semantic.
    return true;
  }

  async optIn(recipient: string, meta?: OptInMeta): Promise<void> {
    const category = meta?.category ?? null;

    // Clear opt-outs for the same scope.
    if (category === null) {
      // Global opt-in supersedes everything.
      await this.pool.query(`DELETE FROM whatsapp.opt_outs WHERE recipient = $1`, [recipient]);
    } else {
      await this.pool.query(
        `DELETE FROM whatsapp.opt_outs WHERE recipient = $1 AND category = $2`,
        [recipient, category]
      );
    }

    // Audit row (idempotent — re-consent is a new event).
    await this.pool.query(
      `INSERT INTO whatsapp.opt_ins (recipient, category, source, attributes, recorded_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5))`,
      [
        recipient,
        category,
        meta?.source ?? null,
        meta?.attributes ? JSON.stringify(meta.attributes) : null,
        (meta?.timestamp ?? Date.now()) / 1000,
      ]
    );
  }

  async optOut(recipient: string, options?: OptOutOptions): Promise<void> {
    const category = options?.category ?? null;
    await this.pool.query(
      `INSERT INTO whatsapp.opt_outs (recipient, category, reason, recorded_at)
       VALUES ($1, $2, $3, to_timestamp($4))
       ON CONFLICT (recipient, category) DO UPDATE
         SET reason = EXCLUDED.reason, recorded_at = EXCLUDED.recorded_at`,
      [recipient, category, options?.reason ?? null, (options?.timestamp ?? Date.now()) / 1000]
    );
  }
}
```

The `ON CONFLICT` clause makes `optOut` idempotent — calling
it twice with the same (recipient, category) just updates the
timestamp + reason on the existing row.

## Wiring it up

```ts
// lib/whatsapp.ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Pool } from "pg";

import { PostgresOptInRegistry } from "./opt-in-postgres";

const pool = new Pool({ connectionString: process.env.POSTGRES_URL! });
const optInRegistry = new PostgresOptInRegistry(pool);

export const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  token: process.env.WHATSAPP_ACCESS_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  optInRegistry,
});
```

## Inbound STOP-keyword handler

```ts
// app/api/webhooks/whatsapp/route.ts
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";
import { waitUntil } from "@vercel/functions";

import { client } from "@/lib/whatsapp";
import { optInRegistry } from "@/lib/opt-in";

export const runtime = "nodejs";

const STOP_KEYWORDS = new Set(["STOP", "BAJA", "UNSUBSCRIBE", "PARAR", "CANCELAR"]);

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (e) => {
  const body = (e.body?.text as { body?: string } | undefined)?.body;
  if (body === undefined) return;

  const normalized = body.toUpperCase().trim();
  if (STOP_KEYWORDS.has(normalized)) {
    await optInRegistry.optOut(e.from, {
      reason: `stop-keyword:${normalized}`,
      timestamp: Date.now(),
    });
    // Optional: send confirmation BEFORE the opt-out takes effect.
    // The pre-flight gates future sends, not this one.
    try {
      await client.sendTemplate({
        to: e.from,
        name: "unsubscribe_confirm",
        language: "es_MX",
      });
    } catch {
      // already opted out → just log
    }
  }
});

const handler = createWhatsAppHandler(receiver, { waitUntil });
export const GET = handler;
export const POST = handler;
```

## Multi-tenancy

For multi-tenant deployments, prefix `recipient` with a
tenant id in your adapter:

```ts
async isOptedIn(recipient: string, options?: OptInQuery): Promise<boolean> {
  return baseImpl.isOptedIn(`${this.tenantId}:${recipient}`, options);
}
```

Or extend the schema with a `tenant_id` column and key on
`(tenant_id, recipient, category)`.

## Audit queries

The `opt_ins` table is a full audit trail. Defensibility
queries:

```sql
-- "When did this recipient consent to MARKETING?"
SELECT recorded_at, source, attributes
FROM whatsapp.opt_ins
WHERE recipient = '+5210000000001' AND category = 'MARKETING'
ORDER BY recorded_at DESC
LIMIT 1;

-- "Show me every opt-out from the last 24 hours."
SELECT recipient, category, reason, recorded_at
FROM whatsapp.opt_outs
WHERE recorded_at > now() - interval '24 hours'
ORDER BY recorded_at DESC;
```

## Caveats

- **Bulk send pre-flight performance.** A 10k-recipient
  marketing push runs `isOptedIn` 10k times. Each is one
  Postgres round-trip (~1ms + network). For batch sends,
  bulk-fetch the opt-out state up front:

  ```ts
  const { rows } = await pool.query(
    `SELECT recipient FROM whatsapp.opt_outs WHERE recipient = ANY($1) AND (category IS NULL OR category = $2)`,
    [recipientBatch, "MARKETING"]
  );
  const optedOut = new Set(rows.map((r) => r.recipient));
  const eligible = recipientBatch.filter((r) => !optedOut.has(r));
  // ...then send to `eligible` only
  ```

- **Right to be forgotten.** Ley 8968 / GDPR right-to-erasure
  requests should delete both `opt_outs` AND `opt_ins` rows
  for the recipient. The audit trail is the cost; consent
  data is personal data.

- **Storage size.** Opt-out rows are tiny (~100 bytes). Even
  at 10M opt-outs the table is <1 GB. Don't over-think
  this; index on recipient and you're done.

## See also

- [`docs/sdk/opt-in.md`](../../sdk/opt-in.md) — the
  `OptInRegistry` reference.
- [`docs/cookbook/integrations/next-app-router-supabase.md`](../integrations/next-app-router-supabase.md)
  — full-stack Site2Print-shape recipe (web adapter +
  Postgres window tracker + MCP toolset).
