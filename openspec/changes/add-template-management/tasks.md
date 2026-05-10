## 1. Types

- [ ] 1.1 Create `src/templates/types.ts` exporting `TemplateDefinition`, `TemplateComponentDefinition` (header / body / button / footer with `text?`, `format?`, `example?`, `buttons?`), `ListTemplatesQuery`, `ListTemplatesResponse`.

## 2. Placeholder counter

- [ ] 2.1 Create `src/templates/placeholders.ts` exporting `countTemplatePlaceholders(text)`. 1-indexed, contiguous, no `{{0}}`. Throws `TemplateError` with a message naming the missing index when gaps exist.
- [ ] 2.2 Add `test/unit/templates/placeholders.test.ts` covering 0 / 1 / 3 contiguous, repeated indices, gaps, `{{0}}`, non-numeric `{{X}}`.

## 3. Cross-validator

- [ ] 3.1 Create `src/templates/validate.ts` exporting `validateTemplateSend(payload, definition)`. Asserts name + language + per-component param-count + button (sub_type + index) match. Throws `TemplateError(message, definition.name)` on mismatch.
- [ ] 3.2 Add `test/unit/templates/validate.test.ts` covering: matching → returns; wrong name; wrong language; param count short; param count long; absent component in def; button sub_type mismatch.

## 4. Read API

- [ ] 4.1 Create `src/templates/api.ts` exporting `listTemplates(client, query?)` (`GET /{wabaId}/message_templates?…`) and `getTemplate(client, templateId)` (`GET /{templateId}`).
- [ ] 4.2 Add `test/contract/template-management/api.test.ts` (msw): listTemplates URL + query params; getTemplate URL; both parse Meta's response into `TemplateDefinition[]` / `TemplateDefinition`.

## 5. Client integration

- [ ] 5.1 Add `client.listTemplates(query?)` and `client.getTemplate(templateId)` convenience methods on `WhatsAppClient`.
- [ ] 5.2 Widen `BuildTemplateInput` with optional `validateAgainst?: TemplateDefinition`. Update `buildTemplate` to call `validateTemplateSend` when set.
- [ ] 5.3 `client.sendTemplate(input)` continues to delegate to `buildTemplate`; the `validateAgainst` flows through naturally because it's part of the input shape.

## 6. Public surface

- [ ] 6.1 `src/templates/index.ts` re-exports types + placeholders helper + validator + read API.
- [ ] 6.2 `src/index.ts` re-exports the new templates module.

## 7. Tests for the validateAgainst plumbing

- [ ] 7.1 Add `test/contract/template-management/validate-against.test.ts` (msw): `client.sendTemplate({ ..., validateAgainst })` rejects with `TemplateError` on mismatch and NO HTTP fires; matching definition lets the request through.

## 8. Verification

- [ ] 8.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [ ] 8.2 `pnpm test:coverage` — gates honoured.
- [ ] 8.3 `pnpm build` — `TemplateDefinition`, `listTemplates`, `getTemplate`, `validateTemplateSend`, `countTemplatePlaceholders`, `client.listTemplates`, `client.getTemplate` all in `dist/index.d.ts`.
- [ ] 8.4 `openspec validate add-template-management --strict` passes.
