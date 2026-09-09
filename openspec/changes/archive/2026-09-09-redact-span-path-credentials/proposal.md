# Change proposal — redact query strings from the `whatsapp.path` span attribute

Affected capability: `cloud-api-client` (observability requirement
"Every Graph API request emits an OTel span").

## Why

`healthCheck()` calls `GET /debug_token?input_token=<bearer token>`.
The transport records the full request path — query string
included — as the `whatsapp.path` span attribute. Any OTel
exporter therefore stores the long-lived System User token in
plain text. This violates the domain rule "attributes redact
PII" and the convention "errors never carry credential values"
(audit finding F1, probe P1).

## What Changes

- `whatsapp.path` SHALL carry only the path component. Anything
  from the first `?` onward is stripped before the attribute is
  attached. The wire request is unchanged.
- `healthCheck()` continues to pass `input_token` as a query
  parameter (Meta's documented shape); the redaction happens at
  the span boundary, so any future query-bearing endpoint is
  covered too.
- New negative-path contract test: no span attribute value on
  the `healthCheck` span contains the token.

## Non-goals

- Changing how the token is transported to `/debug_token`.
- Redacting Meta error messages recorded via
  `span.recordException` (they do not echo tokens today).

## Impact

- `cloud-api-client` spec: 1× MODIFIED requirement.
- `docs/sdk/observability.md` attribute table updated.
- Non-breaking; patch-level.
