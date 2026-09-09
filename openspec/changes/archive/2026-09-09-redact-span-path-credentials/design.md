# Design — redact query strings from `whatsapp.path`

## Chosen approach

In `src/client/transport.ts#request`, compute the span attribute
from `path.split("?")[0]` (normalised to a leading slash). The
URL passed to `fetch` is built from the untouched `path`, so the
wire request is byte-identical to today.

Domain rules satisfied:

- "Every external API call … gets an OpenTelemetry span;
  attributes redact PII" — the attribute no longer carries the
  bearer token or any other query-string value.
- "Errors never carry credential values" — extended to spans.

## Alternatives considered

- Move `input_token` into a header/body for `/debug_token`: Meta
  documents the query-parameter form only; would also leave any
  future query-bearing endpoint unprotected.
- Redact only `input_token`: allow-listing one parameter name is
  brittle; stripping the whole query string is the safe default
  and `whatsapp.path` is documented as a grouping key, not a
  full URL.
