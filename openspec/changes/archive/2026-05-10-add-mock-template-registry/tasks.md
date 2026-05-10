## 1. Options

- [x] 1.1 Add `templates?: ReadonlyArray<TemplateDefinition>` to `MockWhatsAppClientOptions` in `src/mock/types.ts`.

## 2. Implementation

- [x] 2.1 Update `src/mock/client.ts` `MockWhatsAppClient`:
  - Store the seed (default `[]`) in a private field.
  - Replace the unconditional empty-array return in `listTemplates(query?)` with in-memory filtering.
  - Replace the unconditional reject in `getTemplate(templateId)` with a lookup; reject with `TemplateError(templateId)` only when the id isn't in the seed.

## 3. Factory

- [x] 3.1 Update `src/mock/factory.ts` `pickWhatsAppClient`: pass `options.templates` through to `MockWhatsAppClient` when `forceMock` / env routes to mock.

## 4. Tests

- [x] 4.1 Add `test/unit/mock/templates.test.ts`:
  - Empty seed: `listTemplates()` → `{ data: [] }`; `getTemplate("x")` rejects with `TemplateError`.
  - Single template seed: `listTemplates()` returns the seed; `getTemplate(id)` resolves with the entry.
  - `listTemplates({ status: "APPROVED" })` filters by status.
  - `listTemplates({ name: "appt", language: "en_US" })` AND-filters by name and language.
  - `listTemplates({ limit: 1 })` truncates the response.
  - `getTemplate("missing")` rejects with `TemplateError` carrying templateId.

## 5. Spec deltas

- [x] 5.1 Update `openspec/changes/add-mock-template-registry/specs/mock-mode/spec.md` with the modified-requirement delta.

## 6. Docs

- [x] 6.1 `docs/mock.md`: add a "Template registry" subsection with a runnable example. Update the parity-divergence note.
- [x] 6.2 `docs/compliance.md` § 3.5: replace divergence with a "Resolved" note pointing at this change.

## 7. Verification

- [x] 7.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 7.2 `pnpm test` passes (existing parity tests unaffected; new template-registry tests pass).
- [x] 7.3 `openspec validate add-mock-template-registry --strict` passes.

## 8. Archive

- [x] 8.1 `openspec archive add-mock-template-registry`.
