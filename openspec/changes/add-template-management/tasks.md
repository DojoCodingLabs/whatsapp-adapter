## 1. Types

- [x] 1.1 Create `src/templates/types.ts` exporting `TemplateDefinition`, `TemplateComponentDefinition`, `TemplateButtonDefinition`, `ListTemplatesQuery`, `ListTemplatesResponse`. Open-ended unions widen to `string` for forward compat.

## 2. Placeholder counter

- [x] 2.1 Create `src/templates/placeholders.ts` exporting `countTemplatePlaceholders(text)`. 1-indexed, contiguous, no `{{0}}`.
- [x] 2.2 Add `test/unit/templates/placeholders.test.ts`. (8 cases)

## 3. Cross-validator

- [x] 3.1 Create `src/templates/validate.ts` exporting `validateTemplateSend(payload, definition)`.
- [x] 3.2 Add `test/unit/templates/validate.test.ts`. (8 cases)

## 4. Read API

- [x] 4.1 Create `src/templates/api.ts` exporting `listTemplates` and `getTemplate` against `/{wabaId}/message_templates` and `/{templateId}`.
- [x] 4.2 Add `test/contract/template-management/api.test.ts`. (4 cases)

## 5. Client integration

- [x] 5.1 Add `client.listTemplates(query?)` and `client.getTemplate(templateId)` convenience methods.
- [x] 5.2 Widen `BuildTemplateInput` with optional `validateAgainst?: TemplateDefinition`. `buildTemplate` runs `validateTemplateSend` when set.
- [x] 5.3 `client.sendTemplate` is async so synchronous `validateAgainst` mismatches surface as rejected promises.

## 6. Public surface

- [x] 6.1 `src/templates/index.ts` re-exports types + helper + validator + read API.
- [x] 6.2 `src/index.ts` re-exports the templates module.

## 7. Tests for the validateAgainst plumbing

- [x] 7.1 Add `test/contract/template-management/validate-against.test.ts`. (3 cases) Mismatch rejects without HTTP; matching definition lets request through; without validateAgainst, no local validation.

## 8. Verification

- [x] 8.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 8.2 `pnpm test:coverage` — 246/246 tests; 96.45% lines / 85.23% branches.
- [x] 8.3 `pnpm build` — all new exports in `dist/index.d.ts`.
- [x] 8.4 `openspec validate add-template-management --strict` passes.
