## Why

The agentic front-desk system needs an internal WhatsApp adapter SDK (`@dojocoding/whatsapp`) that other services depend on. Before any capability can be specified, the package needs a working skeleton: TS build, dual ESM+CJS emit, test runner, lint, CI, typed error hierarchy, pinned Graph API version. This change introduces two foundational capabilities — `cloud-api-client` and `webhook-receiver` — as **stubs** that later phases extend.

## What Changes

- **NEW** package skeleton at `whatsapp-adapter/`: `package.json` (`@dojocoding/whatsapp`, Node ≥20, dual ESM+CJS exports including `./express` subpath placeholder), strict `tsconfig.json` + `tsconfig.build.json`, `tsup.config.ts`, `vitest.config.ts` with coverage gates (line ≥90, branch ≥85), `eslint.config.mjs`, `.prettierrc`.
- **NEW** source layout under `src/`: `client/`, `messages/`, `webhooks/`, `window/`, `templates/`, `mock/`, `observability/`, `adapters/`, `types/`, plus root `index.ts` re-exporting the public surface.
- **NEW** typed error hierarchy in `src/types/errors.ts`: `WhatsAppError` (base), `MissingCredentialsError`, `RateLimitError`, `WindowClosedError`, `WebhookSignatureError`, `TemplateError`, `MockModeError`. No behavior yet — only classes + `code` discriminants.
- **NEW** version constants in `src/types/constants.ts`: `GRAPH_API_VERSION = "v23.0"`, `META_GRAPH_BASE_URL`, `WEBHOOK_ACK_DEADLINE_MS = 30_000`, `WINDOW_TTL_MS = 24 * 60 * 60 * 1000`.
- **NEW** test layout under `test/`: `unit/`, `fixtures/`, `contract/`, `integration/`, `parity/`, `__fixtures__/webhooks/` (PII-redacted Meta payloads).
- **NEW** GitHub Actions workflow `.github/workflows/ci.yml`: typecheck, lint, test --coverage, build, `openspec validate` for any touched change.
- **NEW** capability stubs `cloud-api-client/spec.md` and `webhook-receiver/spec.md` with one placeholder requirement each (real requirements added in Phase 1 and Phase 3 respectively).

## Capabilities

### New Capabilities
- `cloud-api-client`: HTTP client for Meta's Graph API — auth, retry, version pin, error-code mapping. Phase 0 lands a stub requirement; Phase 1 adds the real surface.
- `webhook-receiver`: Inbound webhook handling — handshake, raw-body capture, HMAC verify, dedupe, polymorphic dispatch. Phase 0 lands a stub requirement; Phase 3 adds the real surface.

### Modified Capabilities
None — this is the first change in the project; `openspec/specs/` is empty.

## Non-goals

- **No real Cloud API behavior**: the `cloud-api-client` stub does not call Meta yet. Phase 1 adds the HTTP client, retry, and error mapping.
- **No real webhook behavior**: the `webhook-receiver` stub does not verify or dispatch yet. Phase 3 adds the receiver.
- **No message builders, no window tracker, no templates, no mock mode, no OTel, no Express adapter**: each is its own subsequent change.
- **No Embedded Signup, no MCP wrapper, no Voice/Calls, no Flows beyond send-only `interactive.flow`**: out of scope for v1 entirely.
- **No publishing**: the package is not published to npm in this change. CI builds and tests only.

## Impact

- **Code**: net-new `whatsapp-adapter/` source, test, and CI scaffolding. No production code yet — every export is either a constant or an empty class.
- **APIs**: `WhatsAppError` and the constant exports become public; subsequent phases extend the surface but cannot rename or remove these without a `MODIFIED` delta.
- **Dependencies**: introduces `typescript`, `tsup`, `vitest`, `@vitest/coverage-v8`, `eslint`, `prettier`, `@types/node`, `zod`, `msw`, `supertest`, `fast-check`, `@opentelemetry/api`. All declared as `devDependencies` except `zod` and `@opentelemetry/api` which are runtime peers.
- **Systems**: none. Adapter is consumed via package import only; no runtime infra is required.
