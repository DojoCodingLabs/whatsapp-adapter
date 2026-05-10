## Why

`MockWhatsAppClient.listTemplates()` returns `{ data: [] }` unconditionally and `getTemplate()` rejects with a `TemplateError`. This is the one intentional parity break vs the real client (the mock has no upstream to query), but it forces every test that wants `client.sendTemplate({ ..., validateAgainst })` to pre-bake a template definition via `vi.spyOn` boilerplate. The pattern recurs often enough that it deserves a first-class option.

This change adds an optional `templates: TemplateDefinition[]` seed to `MockWhatsAppClientOptions`. When present, `listTemplates(query?)` filters the seed by the supplied query fields and `getTemplate(templateId)` resolves with the matching seed entry (or rejects with `TemplateError` when not found). The empty default preserves today's behaviour, so existing tests are unaffected.

## What Changes

- **MODIFIED** `src/mock/types.ts` `MockWhatsAppClientOptions`:
  - Add `templates?: ReadonlyArray<TemplateDefinition>` field.
- **MODIFIED** `src/mock/client.ts` `MockWhatsAppClient`:
  - Store the supplied seed in a `#templates` private field (default `[]`).
  - `listTemplates(query?)` filters by `query.name`, `query.language`, `query.status`, `query.category` (in-memory, simple equality), respects `query.limit`, returns `{ data, paging?: {} }`.
  - `getTemplate(templateId)` resolves with `#templates.find((t) => t.id === templateId)` or rejects with `TemplateError` carrying the templateId.
- **MODIFIED** `src/mock/factory.ts` `pickWhatsAppClient`: forwards `options.templates` to `MockWhatsAppClient` when constructing.
- **MODIFIED** `openspec/specs/mock-mode/spec.md`: relax the existing `listTemplates`/`getTemplate` parity rule to include the optional registry behaviour.
- **NEW** unit tests under `test/unit/mock/templates.test.ts`.

## Capabilities

### Modified Capabilities

- `mock-mode`: `MockWhatsAppClient` now optionally maintains a tests-supplied template registry; default behaviour (empty registry, `getTemplate` rejecting) unchanged.

## Non-goals

- **No template authoring API.** The registry is read-only. Tests that need to mutate templates can construct a new mock or replace the seed.
- **No status-transition simulation.** The seed is whatever the test gives it. Simulating Meta's APPROVED → PAUSED transition is the consumer's job (mutate the seed and re-construct, or stub `getTemplate` per test).
- **No paging beyond `limit`.** `before` / `after` cursors are accepted on the query but not honoured (the registry is small enough to ignore in tests). If a test needs paging, it should construct two mock instances with different seeds.
- **No real-client behaviour change.** This is a `MockWhatsAppClient`-only addition.

## Impact

- **Code:** ~50 LOC added to `src/mock/client.ts` and `src/mock/types.ts`.
- **Public API:** one new optional field on `MockWhatsAppClientOptions`. Non-breaking.
- **Tests:** new unit suite at `test/unit/mock/templates.test.ts`; existing parity tests are unaffected (they don't set `templates`).
- **Risk:** very low. The registry behaviour is local to the mock and gated behind an opt-in option.
