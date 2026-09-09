## 1. Transport

- [x] 1.1 `src/client/transport.ts`: derive `whatsapp.path` from the path component only (strip from the first `?`).

## 2. Tests

- [x] 2.1 `test/contract/observability/transport-spans.test.ts`: `healthCheck` span — `whatsapp.path === "/debug_token"` and no attribute value contains the token.
- [x] 2.2 Same file: a query-bearing `client.request("GET", "/me?fields=id")` records `whatsapp.path === "/me"`.

## 3. Docs

- [x] 3.1 `docs/sdk/observability.md`: attribute table notes that the query string is never recorded.
