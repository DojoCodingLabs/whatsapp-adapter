## 1. Dev / runtime dependencies

- [x] 1.1 `pnpm add zod@^3` (runtime dep)
- [x] 1.2 `pnpm add -D fast-check@^3` (devDep for property tests)

## 2. Types

- [x] 2.1 Create `src/messages/types.ts` defining the `WhatsAppMessage` discriminated union plus per-variant `*Input` types (caller-friendly shapes for builders) and `MessageSendResponse`.

## 3. Schemas

- [~] 3.1 zod schemas were folded into the per-builder runtime guards (lighter touch — builders throw `WhatsAppError` directly with named-field messages). Cross-cutting `z.discriminatedUnion`-based schemas can be added in a future change if a consumer needs to validate untrusted-side input wholesale.
- [x] 3.2 Helper `requireE164(to)`-like guard implemented inline as `ensureRecipient(to)` in `src/messages/builders.ts`.

## 4. Builders

- [x] 4.1 Create `src/messages/builders.ts` exporting all 13 builders. Each parses input via runtime guards, emits the wire payload, and applies `replyTo` → top-level `context.message_id`.
- [x] 4.2 Special handling: `buildImage`/`buildVideo`/`buildAudio`/`buildDocument`/`buildSticker` accept `id XOR link` and reject "neither" or "both".
- [x] 4.3 Special handling: `buildLocation` validates `latitude ∈ [-90, 90]` and `longitude ∈ [-180, 180]` (and rejects NaN).
- [x] 4.4 Special handling: `buildInteractiveButton` enforces 1–3 buttons; `buildInteractiveList` enforces 1–10 sections × 1–10 rows.
- [x] 4.5 Special handling: `buildTemplate` validates component types and button.sub_type. Cross-validating placeholder counts against approved-template definitions is Phase 5's job.
- [x] 4.6 Special handling: `buildReaction` allows empty-string emoji to clear.
- [x] 4.7 Reject `interactive.kind === "flow"` at runtime with a clear "not implemented in v1" `WhatsAppError`.

## 5. Send helpers

- [x] 5.1 Create `src/messages/send.ts` exporting `sendMessage(client, payload)` posting to `/${client.phoneNumberId}/messages`.
- [x] 5.2 Add the 12 convenience methods on `WhatsAppClient`: `sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`, `sendTemplate`, `sendReaction`, `sendReply`.
- [x] 5.3 Wire all message builder + send exports through `src/messages/index.ts` and re-export from `src/index.ts`.

## 6. Tests

- [x] 6.1 Add `test/__fixtures__/messages/` with golden wire-JSON snapshots for each variant (12 files).
- [x] 6.2 Add `test/unit/messages/builders.test.ts` (37 cases).
- [x] 6.3 Add `test/unit/messages/properties.test.ts` using fast-check (5 properties).
- [x] 6.4 Add `test/contract/message-builders/send.test.ts` and `convenience-methods.test.ts` (4 + 12 cases).

## 7. Verification

- [x] 7.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean
- [x] 7.2 `pnpm test:coverage` — 151/151 tests pass; 95.76% lines, 88.33% branches (gates 90/85)
- [x] 7.3 `pnpm build` — `WhatsAppMessage`, all builders, `sendMessage`, `MessageSendResponse` all in `dist/index.d.ts`
- [x] 7.4 `openspec validate add-message-builders --strict` passes
