## Why

Phase 2's `buildTemplate` ships a typed wire shape but cannot detect parameter-count mismatches against the *approved* template definition — it only knows the caller-declared `parameters` array. Meta rejects mismatches with `132012` after the fact, which costs an HTTP round-trip and shows up as a `TemplateError`. Phase 5 introduces the `template-management` capability: read API for `/{waba-id}/message_templates`, a placeholder-counting helper, a `validateTemplateSend` cross-validator, and an optional `validateAgainst` option on `client.sendTemplate` so consumers can fail closed before the network call.

## What Changes

- **NEW** capability `template-management`.
- **NEW** type `TemplateDefinition` modelling Meta's approved-template shape (`name`, `language`, `category`, `status`, `components: [{ type, format?, text?, example?, buttons? }]`).
- **NEW** `listTemplates(client, query?) → Promise<{ data: TemplateDefinition[]; paging?: ... }>` posting `GET /{wabaId}/message_templates`. Query supports `name`, `language`, `status`, `category`, `limit`, `after`, `before`.
- **NEW** `getTemplate(client, templateId) → Promise<TemplateDefinition>` for one-by-id lookup.
- **NEW** convenience methods `client.listTemplates(query?)` and `client.getTemplate(templateId)`.
- **NEW** `countTemplatePlaceholders(text) → number` helper that counts unique `{{N}}` indices, validates strict 1-indexed contiguous numbering (no gaps), and throws on `{{0}}` or non-numeric placeholders.
- **NEW** `validateTemplateSend(payload, definition)` that, given a built `TemplateMessage` payload and the approved `TemplateDefinition`, asserts:
  - language code matches
  - every component listed in the payload exists in the definition with matching `type` (`header`/`body`/`button`/`footer`)
  - parameter counts on each component match the placeholder count in the definition's component text
  - button components target the correct `sub_type` and `index`
  Mismatches throw `TemplateError(message, templateName)`.
- **NEW** optional `validateAgainst?: TemplateDefinition` on `BuildTemplateInput` and on `client.sendTemplate(input)`. When set, the SDK runs `validateTemplateSend` BEFORE the HTTP request and throws a `TemplateError` instead of waiting for Meta's `132012`.

## Capabilities

### New Capabilities
- `template-management`: read API, placeholder counter, cross-validator, and the optional `validateAgainst` plumbing through `sendTemplate`.

### Modified Capabilities
- `message-builders`: adds the optional `validateAgainst` field on `BuildTemplateInput` and gives `buildTemplate` an additional pre-flight validation step when it is provided.

## Non-goals

- **No template authoring** (create / edit / delete). Meta's template-creation flow goes through Business Manager UI; programmatic creation is a separate, future change with significant approval-flow plumbing.
- **No automatic template-definition cache**: every `validateAgainst` requires the caller to fetch the definition (via `client.getTemplate` or their own cache). The SDK does not invisibly call Meta on every send.
- **No translation / locale fallback**: a payload's `language.code` must exactly match the definition's `language` field.
- **No quality-score filtering** in `listTemplates`: Meta's `/message_templates` endpoint surfaces `quality_score` in the response; consumers can filter.

## Impact

- **Code**: net-new `src/templates/{types.ts,placeholders.ts,validate.ts,api.ts}` and `src/templates/index.ts` re-exports. `src/messages/builders.ts` extends `BuildTemplateInput`. `src/client/whatsapp-client.ts` adds `listTemplates`, `getTemplate`, and threads `validateAgainst` through `sendTemplate`. `src/index.ts` re-exports the templates surface.
- **APIs**: new public functions and methods. `BuildTemplateInput` widens (additive — no breaking change for existing callers).
- **Dependencies**: none.
- **Systems**: contract tests use the existing msw setup for the read API; placeholder counting + cross-validation are pure-function unit tests.
