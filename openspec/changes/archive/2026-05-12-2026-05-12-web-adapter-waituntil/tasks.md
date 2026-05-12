## 1. Phase 1 — wire `waitUntil` into the web adapter

- [ ] 1.1 Add `waitUntil?: (promise: Promise<unknown>) => void` to `CreateWhatsAppHandlerOptions` in `packages/whatsapp-sdk/src/adapters/web/index.ts`.
- [ ] 1.2 In the POST branch, replace `result.dispatchPromise.catch(onUnhandledHandlerError);` with:
  ```ts
  const settled = result.dispatchPromise.catch(onUnhandledHandlerError);
  if (options?.waitUntil !== undefined) {
    options.waitUntil(settled);
  }
  ```
  Order matters: chain `.catch` first, then pass the always-resolving promise to `waitUntil` so no unhandled rejections leak.
- [ ] 1.3 JSDoc on the new option naming the Vercel + Workers integration points.

## 2. Phase 2 — contract tests

- [ ] 2.1 Add `packages/whatsapp-sdk/test/contract/adapters/web/wait-until.test.ts`:
  - When `waitUntil` is supplied and a handler resolves successfully, `waitUntil` SHALL be called exactly once, with a promise that resolves.
  - When `waitUntil` is supplied and a handler throws, `waitUntil` SHALL be called exactly once, with a promise that resolves (NOT rejects) because the error went through `onUnhandledHandlerError`.
  - When `waitUntil` is omitted, the adapter SHALL behave exactly as today (no observable change).
  - `waitUntil` SHALL be called AFTER the 200 ack is computed (verified by ordering of promise resolution vs the function's return).
  - `waitUntil` SHALL NOT be called on the GET branch.
- [ ] 2.2 Add a test that confirms the existing `dispatchPromise` error-handling contract is preserved (errors reach `onUnhandledHandlerError`).

## 3. Phase 3 — docs

- [ ] 3.1 Update `docs/sdk/web.md` § "Next.js App Router" with the Vercel `waitUntil` snippet:
  ```ts
  import { waitUntil } from "@vercel/functions";
  const handler = createWhatsAppHandler(receiver, { waitUntil });
  ```
- [ ] 3.2 Add a § "Cloudflare Workers" snippet to `docs/sdk/web.md`:
  ```ts
  export default {
    fetch(req: Request, env: Env, ctx: ExecutionContext) {
      const handler = createWhatsAppHandler(receiver, {
        waitUntil: ctx.waitUntil.bind(ctx),
      });
      return handler(req);
    },
  };
  ```
- [ ] 3.3 Update `docs/compatibility.md` per-runtime matrix to note `waitUntil` requirement on serverless / Workers, and explicit "not needed" for Node / Bun / Deno standalone.

## 4. Phase 4 — ship `sdk-v0.9.0` (bundled with the other Phase A SDK changes)

- [ ] 4.1 Bump `packages/whatsapp-sdk/package.json` to `0.9.0`.
- [ ] 4.2 Add `## [0.9.0] — 2026-05-12` CHANGELOG entry covering this change + A3 (`ctwa_clid`) + A4 (idempotency-key cleanup).
- [ ] 4.3 Verify full gate green.
- [ ] 4.4 Archive this change: `openspec archive 2026-05-12-web-adapter-waituntil`.
