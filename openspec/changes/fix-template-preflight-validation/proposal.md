# Change proposal — template pre-flight validation covers media headers, named parameters, and numeric button indices

Affected capability: `template-management`.

## Why

The 2026-09-07 deep audit found three gaps in
`validateTemplateSend` that let malformed sends reach Meta and
fail at HTTP time with error `132012` / `132000` instead of
synchronously:

- **F3 — media headers pass with zero parameters.** A `HEADER`
  with `format: IMAGE | VIDEO | DOCUMENT | LOCATION` has no
  `{{N}}` text, so `countTemplatePlaceholders(undefined)` returned
  `0` and a payload with no header parameter validated clean.
  Meta requires exactly one parameter whose `type` matches the
  format.
- **F15 — named parameters unsupported.** Meta's
  `parameter_format: "NAMED"` templates use `{{customer_name}}`
  placeholders and require `parameter_name` on every send-time
  parameter. The SDK's regex only matched `\d+`, so named
  templates counted as zero placeholders and the wire type had no
  `parameter_name` field.
- **F16 — numeric button `index` rejected.** `TemplateComponent.index`
  is `string | number` (Meta documents `"0"` for auth buttons and
  `0` for carousel-card buttons), but the validator only accepted
  strings, so any numeric index threw `TemplateError`.

## What Changes

- `TemplateDefinition` gains `parameter_format?: "POSITIONAL" | "NAMED"`;
  `TemplateComponentDefinition.format` is typed as
  `TemplateMediaHeaderFormat` (`TEXT | IMAGE | VIDEO | DOCUMENT | LOCATION`,
  with string fallback).
- `TemplateParameterText | Currency | DateTime` gain
  `parameter_name?: string`; a new `TemplateParameterLocation`
  variant joins the `TemplateParameter` union for `LOCATION`
  headers.
- New exports `listTemplatePlaceholders`,
  `hasNamedTemplatePlaceholders`, `extractNamedTemplatePlaceholders`.
  `countTemplatePlaceholders` now throws `TemplateError` when it
  meets a named placeholder rather than silently returning 0.
- `validateTemplateSend`:
  - media / location headers: exactly one parameter, `type` equal
    to the lower-cased header format;
  - named components: set-equality between `parameter_name`s and
    `{{name}}` placeholders (order-insensitive, duplicates rejected,
    mixed positional/named definitions rejected); NAMED is taken
    from `definition.parameter_format` or inferred from the text;
  - button `index`: accepts a whole number ≥ 0 as string or number.

## Non-goals

- Per-card carousel placeholder validation (tracked separately in
  the `add-message-types-2026q2` archive).
- Validating `example` values on the definition.

## Impact

- `template-management` spec: 2× MODIFIED requirements, 1× ADDED.
- `docs/sdk/templates.md` updated.
- Additive for consumers; stricter for the media-header and named
  cases that previously validated clean but failed at Meta. Minor.
