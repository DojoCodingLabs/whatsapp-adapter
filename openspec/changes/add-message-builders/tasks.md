## 1. Dev / runtime dependencies

- [ ] 1.1 `pnpm add zod@^3` (runtime dep)
- [ ] 1.2 `pnpm add -D fast-check@^3` (devDep for property tests)

## 2. Types

- [ ] 2.1 Create `src/messages/types.ts` defining the `WhatsAppMessage` discriminated union plus per-variant `*Input` types (caller-friendly shapes for builders) and `MessageSendResponse`.

## 3. Schemas

- [ ] 3.1 Create `src/messages/schemas.ts` exporting one zod schema per variant input plus a top-level `MessageInputSchema` union. All schemas have explicit error messages naming the field that failed.
- [ ] 3.2 Helper `requireE164(to)` schema regex for the recipient `to` field.

## 4. Builders

- [ ] 4.1 Create `src/messages/builders.ts` exporting all 13 builders. Each parses input via the matching zod schema, emits the wire payload, and applies `replyTo` → top-level `context.message_id`.
- [ ] 4.2 Special handling: `buildImage`/`buildVideo`/`buildAudio`/`buildDocument`/`buildSticker` accept `id XOR link` and reject "neither" or "both".
- [ ] 4.3 Special handling: `buildLocation` validates `latitude ∈ [-90, 90]` and `longitude ∈ [-180, 180]`.
- [ ] 4.4 Special handling: `buildInteractiveButton` enforces 1–3 buttons; `buildInteractiveList` enforces 1–10 sections × 1–10 rows.
- [ ] 4.5 Special handling: `buildTemplate` counts placeholder parameters per component (header / body / each button) and matches against caller-provided `parameters` arrays; mismatch throws `TemplateError`.
- [ ] 4.6 Special handling: `buildReaction` allows empty-string emoji to clear.
- [ ] 4.7 Reject `interactive.kind === "flow"` at runtime with a clear "not implemented in v1" `WhatsAppError`.

## 5. Send helpers

- [ ] 5.1 Create `src/messages/send.ts` exporting `sendMessage(client, payload)` posting to `/${client.phoneNumberId}/messages`.
- [ ] 5.2 Add the 12 convenience methods on `WhatsAppClient`: `sendText`, `sendImage`, `sendVideo`, `sendAudio`, `sendDocument`, `sendSticker`, `sendLocation`, `sendContacts`, `sendInteractive`, `sendTemplate`, `sendReaction`, `sendReply`. Each delegates to `sendMessage(this, build…(input))`.
- [ ] 5.3 Wire all message builder + send exports through `src/messages/index.ts` and re-export from `src/index.ts`.

## 6. Tests

- [ ] 6.1 Add `test/__fixtures__/messages/` with golden wire-JSON snapshots for each variant — copy-paste-ready against Meta docs.
- [ ] 6.2 Add `test/unit/messages/builders.test.ts` covering: every builder happy-path produces the matching fixture; every guard rejects (empty `to`, no `id`/no `link`, latitude OOB, 4 buttons, empty section, parameter count mismatch, empty `replyTo`, `interactive.kind="flow"`).
- [ ] 6.3 Add `test/unit/messages/properties.test.ts` using fast-check: valid inputs always serialize; invalid inputs always throw at the type/runtime boundary.
- [ ] 6.4 Add `test/contract/message-builders/send.test.ts` (msw): `sendMessage` POSTs to `/${phoneNumberId}/messages`; response is parsed; `client.sendText({to, body})` round-trip; validator failure happens before any HTTP call.

## 7. Verification

- [ ] 7.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean
- [ ] 7.2 `pnpm test:coverage` — gates honoured (line ≥90, branch ≥85)
- [ ] 7.3 `pnpm build` — `WhatsAppMessage`, builders, `sendMessage`, `MessageSendResponse` all in `dist/index.d.ts`
- [ ] 7.4 `openspec validate add-message-builders --strict` passes
