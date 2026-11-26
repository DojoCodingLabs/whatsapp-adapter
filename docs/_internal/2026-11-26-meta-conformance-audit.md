# `@dojocoding/whatsapp-sdk` — Meta conformance audit (2026-11-26)

Scope: `main` @ `177527c` (0.10.0 + README), both packages. This follows the method of
[`2026-09-07-sdk-deep-audit.md`](./2026-09-07-sdk-deep-audit.md), for the window from 2026-09-09 to
2026-11-26:

- run the full gate on Node 20 and 24;
- fetch Meta's current docs and quote them;
- compare each rule line by line with `src/` and the tests;
- write failing tests first, then fix.

Each evidence matrix row has the quoted Meta text, its URL, the SDK `file:line`, the test that covers it, and a status:

- [`2026-11-26-matrices/matrix-webhooks.md`](./2026-11-26-matrices/matrix-webhooks.md): 47 rows, plus Meta's example payloads copied verbatim.
- [`2026-11-26-matrices/matrix-outbound.md`](./2026-11-26-matrices/matrix-outbound.md): 32 rows.
- [`2026-11-26-matrices/matrix-platform.md`](./2026-11-26-matrices/matrix-platform.md): 37 rows, plus the changelog since 2026-09-01.

Anything marked UNVERIFIED in a matrix was not acted on unless an official page supported it.

---

## 1. Scorecard (before → after the PR stack)

| Area                                                                                  | Before (0.10.0)                                                                                    | After                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Typecheck / lint / build / size / tests (Node 20, 24)                                 | Pass (SDK 859, MCP 201)                                                                            | Pass on Node 20/22/24. The combined stack runs 1102 SDK tests and MCP 201. |
| `pnpm audit --prod`                                                                   | **31 advisories (1 critical, 6 high)**, all in the MCP tree                                        | Clean                                                                      |
| Clean install imports                                                                 | **Fails**: `@opentelemetry/api` is an optional peer but is imported at load                        | Pass. CI now has a clean-room ESM+CJS import check.                        |
| Graph API pin                                                                         | v26.0                                                                                              | v26.0 (still the latest; v23 sunsets 2027-10-08)                           |
| Error-code mapping vs Meta table                                                      | About 15 codes unmapped or misclassified; 5xx classified before the body was read                  | Typed; the Meta error body is read first                                   |
| Throughput bucket                                                                     | Per WABA                                                                                           | Per phone number, as Meta specifies (`perWaba` kept as a deprecated alias) |
| Inbound identity (BSUID / usernames)                                                  | `from: ""` for username users; `contacts[]` unreachable                                            | `fromUserId`, `contact`, `messageSenderKey`                                |
| Silent drops                                                                          | `value.errors`; `user_preferences` dedupe collisions                                               | Typed `webhook_error`; dedupe key includes BSUID                           |
| Dedupe TTL vs Meta's 7-day redelivery                                                 | 24 h                                                                                               | 7 days                                                                     |
| Outbound limits                                                                       | List body capped at 1024 (Meta: 4096); `cta_url` accepted any scheme; reactions accepted `replyTo` | Fixed                                                                      |
| Send to BSUID (`recipient`)                                                           | Missing                                                                                            | Supported; window and opt-in gates key on the identifier used              |
| Media download security                                                               | No size cap; bearer sent to any URL; `mediaId` not encoded                                         | Capped; bearer only to https Meta hosts; encoded                           |
| Provider error text (may echo recipient)                                              | Always embedded                                                                                    | `redactProviderMessages` option                                            |
| Raw wamid in spans                                                                    | Yes                                                                                                | Salted hash                                                                |
| Agent helpers (split / tolerant interactive / fallback / markdown / opt-out keywords) | Missing                                                                                            | `src/reply/`                                                               |
| Repo doc drift                                                                        | config.yaml (v23, 131026), drift template (v25), cookbook (131026), compliance (pricing tense)     | Fixed                                                                      |

## 2. PRs

| PR  | Branch                              | Covers                                                                                                 |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| #28 | `chore/deps-security-and-ci`        | Audit advisories; unused SDK `zod`; MCP on zod 4 + MCP SDK 1.32; vitest 4; Node 20/22/24 CI matrix     |
| #29 | `fix/cloud-api-error-taxonomy`      | Error taxonomy, envelope-first 5xx, per-phone throughput, doc drift, this report                       |
| #30 | `feat/agent-reply-layer`            | `src/reply/*`, `verifyAndParseWebhook`, 400 for signed non-JSON                                        |
| #31 | `fix/outbound-limits-media-privacy` | Limits, BSUID recipient, media hardening, MIME allowlist, provider-message redaction                   |
| #32 | `feat/inbound-identity-bsuid`       | BSUID/contacts, accessors, `webhook_error`, status and pricing fields, 7-day dedupe, hashed wamid span |
| #33 | `fix/otel-api-runtime-dependency`   | OTel import crash + CI clean-room install                                                              |

All of these branch from #28. A local octopus merge of all six passes the full gate on Node 24 and 20. That merge needed only CHANGELOG and `docs/compliance.md` conflict resolution, plus the `/web` size budget raise to 5 KB already in #30.

Consumer check: a Vercel eve 1.3.0 `defineChannel` (custom GET/POST webhook routes, `verifyAndParseWebhook`, `deliverReply`, the accessors) typechecks on Node 24. It was compiled with `strict` and `exactOptionalPropertyTypes`, against the packed tarball, with zod 4 and `ai` 7.

A runtime smoke test used a signed, username-only Meta doc payload. It returned 200, 401 for a bad signature and 400 for non-JSON. The payload parsed to `fromUserId` and `profileName`, and the sender key is the BSUID. On the send side, 9000 characters split into 3 messages, and a rejected interactive message fell back to text.

## 3. Open decisions (maintainer)

1. **Sender-key precedence** (#32): phone first, then BSUID, which keeps existing keys stable, or BSUID first, which stays stable once Meta sends BSUIDs for every user. Decide before 0.11.0. It must agree with how consumers call `notifyInbound`.
2. **Node 20 has been EOL since 2026-04-30**, but `engines` still says `>=20`. Raising the floor to 22 is a minor-version break.
3. **Major-version tooling migrations** (TypeScript 6/7, eslint 10, tsup 9, vitest 5, fast-check 4) are left for separate PRs.
4. **Release**: #33 alone justifies a 0.10.1 patch. Everything else batches into 0.11.0, which is pre-1.0, so breaking changes are listed per PR in the CHANGELOG.

## 4. Deferred, with reasons

- **New interactive types** (location request, voice call, address, non-template carousel) need new builders. The voice-call limits are UNVERIFIED.
- **`recipient_type: group` and group webhooks** need the Groups API as their own capability.
- **Marketing Messages API**, plus codes 131055, 134100 and 134101: needed before the Cloud API marketing sunset on **2027-10-13**.
- **`messaging_account_id`** must be supported before Meta requires it in H1 2027.
- **Webhook fields not yet typed** (forwarded flags, `referred_product`, contacts `origin`, `conversation_context`) are still reachable via raw `body`.
- **SHA-256 verification of downloaded media.**
- **The "30 s ack" wording**: no current Meta page states a figure. Acking before dispatch is still the correct behaviour.
