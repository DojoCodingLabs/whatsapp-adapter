## 1. Types

- [x] 1.1 `src/messages/types.ts`: `NamedTemplateParameter` (`parameter_name?`) mixed into text / currency / date_time; add `TemplateParameterLocation`.
- [x] 1.2 `src/templates/types.ts`: `TemplateMediaHeaderFormat`, `TemplateParameterFormat`, `TemplateDefinition.parameter_format?`.

## 2. Placeholders

- [x] 2.1 `src/templates/placeholders.ts`: `listTemplatePlaceholders`, `hasNamedTemplatePlaceholders`, `extractNamedTemplatePlaceholders`; `countTemplatePlaceholders` throws on named tokens.
- [x] 2.2 Export from `src/templates/index.ts`; add to `test/contract/public-surface.test.ts`.

## 3. Validator

- [x] 3.1 `src/templates/validate.ts`: media / location header branch (exactly one parameter, type matches format).
- [x] 3.2 Named-parameter branch (set equality, duplicates, `parameter_format` or inferred).
- [x] 3.3 Button `index` accepts string or number whole numbers ≥ 0.

## 4. Tests

- [x] 4.1 `test/unit/templates/placeholders.test.ts`: new helpers + named-token rejection.
- [x] 4.2 `test/unit/templates/validate.test.ts`: media header pass / fail cases, named pass / fail cases, numeric index accepted, fractional rejected.

## 5. Docs

- [x] 5.1 `docs/sdk/templates.md`: named-parameter section; validator checklist covers media headers and numeric index.
