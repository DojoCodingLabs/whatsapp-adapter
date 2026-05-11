<!--
Thanks for sending a PR to @dojocoding/whatsapp.

A few prompts that reviewers will check — fill in what's relevant
and delete the rest.
-->

## Summary

<!--
1–3 sentences. WHY this change exists. The code itself shows WHAT
already; the PR description's job is the motivation.
-->

## What changed

<!--
Bullet list of the externally visible changes. Skip refactors that
don't change behaviour.
-->

-

## Spec discipline

- [ ] An OpenSpec change proposal exists under `openspec/changes/<name>/`
      (or this is a `chore:` / `ci:` / `docs:` PR that doesn't change
      behaviour).
- [ ] `openspec validate --changes --strict` passes locally.

## Tests

- [ ] Unit / contract / integration / parity tests cover the change
      at the right layer (see `AGENTS.md` § "Test layers").
- [ ] Negative paths exercised for any new typed error class.
- [ ] No new `setTimeout(_, <ms>)` or `Date.now()` assertions in
      tests (use Promise-resolved-by-handler patterns; see
      `test/contract/adapters/web/signature.test.ts` for the model).
- [ ] `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
      passes locally.

## Compliance

- [ ] No new `any` in production code.
- [ ] Errors are typed classes extending `WhatsAppError`; no thrown
      strings.
- [ ] No swallowed errors. Surface or wrap with context.
- [ ] PII redacted on any new OTel span attributes
      (`hashPhoneNumberId` for phone-number ids / WABA ids).
- [ ] No credential values in error messages or logs.

## Risk

<!--
Brief — what could break? What's the rollback plan? If this is a
release PR, note the target version and the previous one.
-->

## Closes

<!--
Closes #N, fixes #M, refs #K.
-->
