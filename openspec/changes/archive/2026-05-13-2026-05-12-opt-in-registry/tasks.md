## 1. Phase 1 — capability scaffold

- [ ] 1.1 Create `packages/whatsapp-sdk/src/opt-in/types.ts` with the `OptInRegistry`, `OptInQuery`, `OptInMeta`, `OptOutOptions`, and `TemplateCategory` (alias) type definitions.
- [ ] 1.2 Create `packages/whatsapp-sdk/src/opt-in/in-memory.ts` with `InMemoryOptInRegistry` (track explicit opt-ins + opt-outs in separate Maps; `isOptedIn` returns `false` only on explicit opt-out for the queried category or global).
- [ ] 1.3 Create `packages/whatsapp-sdk/src/opt-in/index.ts` barrel exporting the types + class.

## 2. Phase 2 — `OptOutError` typed error class

- [ ] 2.1 Add `"OPT_OUT"` to the `WhatsAppErrorCode` union in `packages/whatsapp-sdk/src/types/errors.ts`.
- [ ] 2.2 Add `OptOutError` class. Constructor takes `recipient: string` + optional `category: TemplateCategory`. Stores `recipient` redacted to last-4 (`***1234` shape). Stores `category` when supplied.
- [ ] 2.3 The message uses the redacted form: `Recipient ***1234 has opted out of MARKETING.` Matches the AuthenticationError redaction pattern.

## 3. Phase 3 — `WhatsAppClient` integration

- [ ] 3.1 Add `optInRegistry?: OptInRegistry` to `WhatsAppClientOptions` in `packages/whatsapp-sdk/src/client/whatsapp-client.ts`.
- [ ] 3.2 Store as `readonly #optInRegistry: OptInRegistry | undefined` on the class.
- [ ] 3.3 Add a private `#assertOptedIn(to: string, category: TemplateCategory | undefined): Promise<void>` helper. When no registry is configured, returns immediately. Else calls `registry.isOptedIn(to, { category })`; on `false`, throws `OptOutError`.
- [ ] 3.4 Wire `#assertOptedIn` into `sendTemplate`, `sendAuthTemplate`, `sendCarouselTemplate`. The category comes from `input.category` if the builder exposes it; else fallback to `"MARKETING"` (conservative default — strictest gating).
- [ ] 3.5 Confirm `sendText` / `sendImage` / etc. do NOT consult the registry.

## 4. Phase 4 — `MockWhatsAppClient` parity

- [ ] 4.1 Add the same `optInRegistry?` option + pre-flight logic to `packages/whatsapp-sdk/src/mock/client.ts`. The mock's `sendTemplate` etc. throw `OptOutError` identically to the real client.
- [ ] 4.2 Update the `WhatsAppLikeClient` interface — actually NO, this is a constructor-only concern; the interface stays unchanged.

## 5. Phase 5 — exports

- [ ] 5.1 Add all opt-in types + `InMemoryOptInRegistry` + `OptOutError` to the re-exports in `packages/whatsapp-sdk/src/index.ts`.
- [ ] 5.2 Update the SDK public-surface drift detector (if any).

## 6. Phase 6 — tests

- [ ] 6.1 Add `packages/whatsapp-sdk/test/unit/opt-in/in-memory.test.ts`:
  - Default behaviour: `isOptedIn` returns true for unknown recipients
  - `optOut` then `isOptedIn` → false
  - `optOut` for category MARKETING, `isOptedIn` for UTILITY → true
  - `optOut` global (no category), `isOptedIn` for any category → false
  - `optIn` after `optOut` (re-consent flow) → `isOptedIn` true again
  - Idempotent `optIn` calls
  - Idempotent `optOut` calls
  - Timestamp metadata captured when supplied
- [ ] 6.2 Add `packages/whatsapp-sdk/test/contract/cloud-api-client/opt-in-pre-flight.test.ts`:
  - With registry configured and recipient opted out → `sendTemplate` throws `OptOutError` BEFORE any HTTP call (assert no MSW handler hit)
  - With registry configured and recipient opted in → `sendTemplate` proceeds normally
  - Without registry configured → `sendTemplate` proceeds (back-compat)
  - `sendText` does NOT consult the registry even when configured
  - `sendAuthTemplate` honours the registry
  - `sendCarouselTemplate` honours the registry
  - `OptOutError.recipient` is the last-4-digit redaction
  - `OptOutError.code === "OPT_OUT"`
- [ ] 6.3 Add `packages/whatsapp-sdk/test/contract/mock/opt-in-parity.test.ts` — the mock client honours the registry identically to the real client.

## 7. Phase 7 — MCP error mapping

- [ ] 7.1 Add an `OptOutError` branch to `packages/whatsapp-mcp/src/errors.ts` `recoveryHint` switch. Recovery hint: `"The recipient has opted out. Record consent (via your opt-in flow / consent ledger) before re-sending. Templates of a different category may still be allowed if the opt-out is category-scoped."`
- [ ] 7.2 Update `packages/whatsapp-mcp/test/unit/errors.test.ts` with the new branch.
- [ ] 7.3 Update `docs/mcp/error-recovery.md` with the new `OPT_OUT` code + hint.

## 8. Phase 8 — docs

- [ ] 8.1 Add `docs/sdk/opt-in.md` — full `OptInRegistry` reference. Interface, default impl, category semantics, soft vs hard opt-in, when not to use (free-form sends don't gate), Postgres adapter recipe.
- [ ] 8.2 Add `docs/cookbook/sdk/opt-in-postgres.md` — end-to-end Postgres-backed registry with migration SQL + inbound STOP-keyword auto-opt-out pattern.
- [ ] 8.3 Update `docs/compliance.md` § "Rules consumers must enforce" with a pointer at the new primitive.

## 9. Phase 9 — ship as part of `sdk-v1.1.0`

- [ ] 9.1 Land the change on `main`. Archive: `openspec archive 2026-05-12-opt-in-registry`.
- [ ] 9.2 Coordinated `sdk-v1.1.0` release bundles this with the other Phase B SDK changes (retry telemetry).
- [ ] 9.3 CHANGELOG `[Unreleased]` entry covers the new capability.
