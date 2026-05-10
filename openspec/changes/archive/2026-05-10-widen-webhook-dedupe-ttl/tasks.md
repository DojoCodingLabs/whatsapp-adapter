## 1. Constant

- [x] 1.1 Update `src/types/constants.ts:9`: `WEBHOOK_DEDUPE_TTL_MS = 60 * 60 * 1000` → `24 * 60 * 60 * 1000`.

## 2. Spec deltas

- [x] 2.1 Update `openspec/changes/widen-webhook-dedupe-ttl/specs/webhook-receiver/spec.md` with the modified-requirement delta.

## 3. Docs

- [x] 3.1 `docs/compliance.md` § 3.2: remove the "1h vs 7-day" divergence; replace with a "Resolved" note pointing at this change.
- [x] 3.2 `docs/webhooks.md`: update the constructor-options example comment from `// optional; default 1h` → `// optional; default 24h`.

## 4. Verification

- [x] 4.1 `pnpm typecheck && pnpm lint && pnpm format:check` clean.
- [x] 4.2 `pnpm test` — `WebhookDeduper` behavioural tests pass without modification (they use explicit TTLs).
- [x] 4.3 `openspec validate widen-webhook-dedupe-ttl --strict` passes.

## 5. Archive

- [x] 5.1 `openspec archive widen-webhook-dedupe-ttl`.
