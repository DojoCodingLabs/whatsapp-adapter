# Templates (`template-management`)

Templates are pre-approved, pre-formatted messages a business can send to
a customer **outside** the 24-hour customer-service window. This module
covers reading approved template definitions from your WABA, counting
their `{{N}}` placeholders, and pre-flight-validating a built
`TemplateMessage` before paying for the round-trip to Meta.

Spec: [`openspec/specs/template-management/spec.md`](../openspec/specs/template-management/spec.md).
Source: [`packages/whatsapp-sdk/src/templates/`](../src/templates/).

## Public exports

```ts
import {
  // Read API (HTTP)
  listTemplates,
  getTemplate,
  // Validation helpers (pure)
  countTemplatePlaceholders,
  validateTemplateSend,
  // Types
  type TemplateDefinition,
  type TemplateComponentDefinition,
  type TemplateComponentDefinitionType,
  type TemplateButtonDefinition,
  type TemplateCategory, // "MARKETING" | "UTILITY" | "AUTHENTICATION" | string
  type TemplateStatus, // "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "FLAGGED" | string
  type ListTemplatesQuery,
  type ListTemplatesResponse,
  type ListTemplatesPaging,
} from "@dojocoding/whatsapp-sdk";
```

The convenience methods `client.listTemplates(query?)` and
`client.getTemplate(templateId)` delegate to `listTemplates(client, query)`
and `getTemplate(client, templateId)` respectively.

## Reading templates

### List

```ts
const page = await client.listTemplates({
  status: "APPROVED",
  limit: 25,
});
// → { data: TemplateDefinition[], paging?: { next?, previous?, cursors? } }

for (const t of page.data) {
  console.log(t.name, t.language, t.category, t.status);
}
```

Query params: `name`, `language`, `status`, `category`, `limit`,
`after`, `before`. `after` / `before` are cursor pagination — pass
`paging.cursors.after` from the previous page to advance.

Calls `GET /{wabaId}/message_templates`.

### Single

```ts
const tpl = await client.getTemplate("123456789");
// → TemplateDefinition with components, status, category, …
```

Calls `GET /{templateId}`.

## `TemplateDefinition` shape

Modelled best-effort against Meta's evolving response shape:

```ts
interface TemplateDefinition {
  id: string;
  name: string;
  language: string; // BCP-47 code, e.g. "en_US", "es_CR"
  category: TemplateCategory; // "MARKETING" | "UTILITY" | "AUTHENTICATION" | …
  status: TemplateStatus; // "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED" | "FLAGGED" | …
  components: ReadonlyArray<TemplateComponentDefinition>;
  quality_score?: { score: string; date?: number };
}

interface TemplateComponentDefinition {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS" | string;
  format?: string; // For headers: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION"
  text?: string; // Body / header text containing {{1}}, {{2}}, …
  example?: { body_text?; header_text?; header_handle? };
  buttons?: ReadonlyArray<TemplateButtonDefinition>; // For BUTTONS components
}
```

Categories and statuses are typed as union-with-string-fallback so a new
Meta value doesn't break consumer code.

## `{{N}}` placeholder rules

Template variables are **1-indexed and contiguous**. The
`countTemplatePlaceholders(text)` helper counts unique `{{N}}` markers
and rejects:

- `{{0}}` (1-indexed; zero is invalid)
- gaps (e.g. `{{1}}` and `{{3}}` without `{{2}}`)

```ts
countTemplatePlaceholders("Hi {{1}}, see you {{2}} at {{3}}"); // → 3
countTemplatePlaceholders("Hi {{1}}, see you {{1}} again"); // → 1 (repeated counts once)
countTemplatePlaceholders("Hi"); // → 0
countTemplatePlaceholders("Hi {{0}}"); // → throws TemplateError
countTemplatePlaceholders("Hi {{1}} — {{3}}"); // → throws TemplateError (missing {{2}})
```

## Sending a template

The simple form (no validation):

```ts
await client.sendTemplate({
  to,
  name: "appointment_reminder",
  language: "en_US",
  components: [
    {
      type: "body",
      parameters: [
        { type: "text", text: "Daniel" },
        { type: "date_time", date_time: { fallback_value: "Tue 10am" } },
      ],
    },
  ],
});
```

This is window-exempt — works even when the 24-hour window is closed.

### Dedicated builders for specialised templates

Three send-time shapes have enough Meta-documented idiosyncrasy that
they ship as dedicated builders. All three live in
[`messages.md`](./messages.md); the cross-link is here:

- **Authentication templates (OTP)** — the OTP code must appear in
  both body and button parameters; use `buildAuthTemplate` /
  `client.sendAuthTemplate` so you don't have to remember.
- **Carousel templates (media cards)** — typed
  `CarouselCard[]` input, `card_index` computed from iteration
  order, capped at Meta's 10-card maximum.
- **Limited-time-offer (LTO) templates** — use the existing
  `client.sendTemplate` with the new
  `limited_time_offer` component and `coupon_code` /
  `payload` parameter types.

See [`messages.md`](./messages.md) §§ "Authentication templates",
"Carousel templates", and "Limited-time-offer templates" for full
payloads.

## Pre-flight validation (`validateAgainst`)

Strongly recommended for production sends. Pass an approved
`TemplateDefinition` and the SDK cross-validates **before** the HTTP call:

```ts
const definition = await client.getTemplate(templateId);

await client.sendTemplate({
  to,
  name: definition.name,
  language: definition.language,
  components: [
    {
      type: "body",
      parameters: [{ type: "text", text: "Daniel" }],
    },
  ],
  validateAgainst: definition, // throws TemplateError on mismatch
});
```

`validateTemplateSend(payload, definition)` checks:

1. `payload.template.name === definition.name`
2. `payload.template.language.code === definition.language`
3. For each component in the payload: the matching definition component
   exists (by type, and for buttons by `sub_type` + `index`)
4. The parameter count equals the placeholder count of the matching
   definition component (header / body text via
   `countTemplatePlaceholders`).

Mismatches throw `TemplateError(message, definition.name)` synchronously.
No HTTP request is made.

## Caching definitions

Template definitions don't change often. A common pattern:

```ts
const cache = new Map<string, TemplateDefinition>();

async function send(to: string, name: string, params: string[]) {
  let def = cache.get(name);
  if (!def) {
    const page = await client.listTemplates({ name, status: "APPROVED" });
    def = page.data[0];
    if (!def) throw new Error(`Template ${name} not approved`);
    cache.set(name, def);
  }
  await client.sendTemplate({
    to,
    name: def.name,
    language: def.language,
    components: [
      {
        type: "body",
        parameters: params.map((text) => ({ type: "text", text })),
      },
    ],
    validateAgainst: def,
  });
}
```

Refresh the cache on the `template_status` webhook event (status
transitions invalidate any held definition):

```ts
receiver.on("template_status", (e) => cache.delete(e.templateName ?? ""));
receiver.on("template_category", (e) => cache.delete(e.templateName ?? ""));
```

## Categories

The three Meta categories carry different rules and pricing:

- **`UTILITY`** — transactional notifications tied to a customer action
  (order updates, appointment reminders, OTPs). Often free inside the
  24-hour service window in Meta's current pricing model.
- **`MARKETING`** — promotional content. Always charged.
- **`AUTHENTICATION`** — OTP / verification codes. Stricter constraints
  on body text and buttons.

Approval lives entirely in Meta Business Manager / the Graph API; this
SDK does not expose template authoring or submission. See "Out of scope"
in [`compliance.md`](./compliance.md#5-out-of-scope-for-v1).

## Gotchas

- **Templates and reactions are window-exempt** — you do not need a
  `WindowTracker` notify to send a template.
- **`{{N}}` is 1-indexed.** Off-by-one is the most common bug source.
  Use `validateAgainst` to catch it before send.
- **Button components require an `index` and `sub_type`.** The
  validator's button check is strict; mis-mapped buttons throw early.
- **`status` and `category` are widened with `string` fallback** — a
  new Meta value won't break compilation but won't auto-narrow either.
- **Mock mode does not maintain a template registry.**
  `MockWhatsAppClient.listTemplates()` returns `{ data: [] }` and
  `getTemplate()` rejects. Stub per-test if needed. See
  [`mock.md`](./mock.md) and
  [`compliance.md` § 3.5](./compliance.md#35-mockwhatsappclient-template-parity).

## Spec scenarios worth knowing

From `openspec/specs/template-management/spec.md`:

- `listTemplates(client, { name: "x", limit: 25 })` →
  `GET /{wabaId}/message_templates?name=x&limit=25`.
- Mismatched param count vs placeholder count → `TemplateError` naming
  the component and the expected vs actual count.
- Wrong template name on payload → `TemplateError`.
- `validateAgainst` mismatch on `client.sendTemplate(...)` →
  rejects without an outbound HTTP request.
