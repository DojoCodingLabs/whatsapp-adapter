## 1. Constants

- [x] 1.1 `MESSAGE_LENGTH_LIMITS` in `src/types/constants.ts`; root export; public-surface drift list.

## 2. Builders

- [x] 2.1 `charCount`, `ensureMaxLength`, `ensureInteractiveHeader` helpers in `src/messages/builders.ts`.
- [x] 2.2 `buildText.body`; media `caption`; interactive button / list / cta_url body, footer, text header, per-button title + id, list button, section title, row id / title / description, cta displayText.

## 3. Tests

- [x] 3.1 `test/unit/messages/length-limits.test.ts` — pinned values, at-limit accepted, over-limit rejected with field + limit in message, code-point counting, media header skipped.

## 4. Docs

- [x] 4.1 `docs/sdk/messages.md` — validation-table row + "Length limits (pre-flight)" section with truncation snippet.
