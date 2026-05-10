## Context

`whatsapp-adapter/` currently holds only the OpenSpec workspace (`openspec/`, `.claude/`). There is no `package.json`, no source, no tests, no CI. Phase 0 establishes the package skeleton so every subsequent capability slice (`add-cloud-api-client`, `add-message-builders`, …) lands on a build that already typechecks, lints, tests, and gates merges through CI. The two foundational capability stubs (`cloud-api-client`, `webhook-receiver`) are introduced here so later changes can use `MODIFIED` deltas against existing specs instead of re-introducing the same capability twice.

Domain rules from `openspec/config.yaml` `context` that this change must satisfy: TypeScript strict (no `any`), ESM+CJS dual emit, Node ≥20, vitest with line ≥90 / branch ≥85 coverage gates, `openspec validate` in CI, no global state, typed error hierarchy, pinned Graph API version (currently `v23.0`) but constructor-overridable, multi-tenant by construction.

## Goals / Non-Goals

**Goals:**
- A `whatsapp-adapter/` package that `pnpm install && pnpm build && pnpm test && pnpm lint && pnpm typecheck` cleanly cycles through.
- Public exports from `src/index.ts`: `WhatsAppClient`, `GRAPH_API_VERSION`, `META_GRAPH_BASE_URL`, `WEBHOOK_ACK_DEADLINE_MS`, `WINDOW_TTL_MS`, the seven error classes, and their TypeScript types.
- A `./express` subpath placeholder export (resolves to a stub module) so the package's `exports` map is final from day one and Phase 8 only needs to fill the body.
- CI runs typecheck + lint + test + build + `openspec validate --changes` on every push.
- One commit per coherent subsystem (config files, error hierarchy, constants, client stub, CI workflow).

**Non-Goals:**
- No real HTTP, retry, or webhook behavior. Phase 1 and Phase 3 add those.
- No publishing to npm. Local-only for now.
- No mock mode, no OTel, no Express middleware body, no message builders, no template ops, no window tracker. Each is its own change.
- No documentation site, no TypeDoc generation. README + JSDoc on public surface only.

## Decisions

### Decision: pnpm + tsup + vitest + ESLint flat config
**Rationale.** pnpm matches the rest of the dojo monorepo expectations and avoids node_modules duplication when this is later consumed as a workspace dep. tsup wraps esbuild, gives ESM+CJS dual emit and `.d.ts` rollup with one config, and is the de-facto choice for typed Node libraries in 2025–2026. vitest has first-class TypeScript support, parallel workers by default, and a coverage gate built on v8. ESLint's flat config (`eslint.config.mjs`) is the supported path going forward; legacy `.eslintrc` is being phased out.
**Alternatives considered.** tsc-only (slower, awkward dual emit). Bun's bundler (good but consumer runtime parity is still Node, and Bun's `.d.ts` story lags). jest (slower in TS, heavier transformer). Rollup (more flexible, more config to own).

### Decision: error classes use `Object.setPrototypeOf(this, new.target.prototype)` and `readonly code`
**Rationale.** Targeting ES2022 and bundling for Node ≥20 means the prototype-chain hack is technically unnecessary, but cross-bundle (`@dojocoding/whatsapp` consumed by an app bundled separately) `instanceof` can still break if the prototype chain is re-walked through a different `Error` constructor. The setPrototypeOf line costs nothing and survives cross-bundle and cross-realm. `readonly code: string` lets consumers do `if (err.code === "WINDOW_CLOSED")` exhaustive checks via TypeScript's discriminated unions.
**Alternatives considered.** Plain `extends Error` without prototype patch (works in Node 20 today, may break under bundler quirks). Tagged-union sentinel objects instead of subclasses (less ergonomic for consumers; loses `Error` semantics).

### Decision: `./express` subpath export is wired up as a stub from day 0
**Rationale.** Adding subpath exports to `package.json` later is a soft-breaking change for consumers who already pinned the major version's `exports` map. Wiring `./express` to a stub module that throws a "Phase 8 not implemented" `Error` from the start lets us evolve the body without a `package.json` shape change. The stub also exercises the dual-emit pipeline immediately.
**Alternatives considered.** Defer subpath until Phase 8 (causes a future `exports` shape change). Single root export only (closes the door on adapter sub-modules entirely).

### Decision: constants live under `src/types/constants.ts` (not `src/constants.ts`)
**Rationale.** `types/` already houses the error hierarchy and shared types; co-locating constants there keeps the public-surface footprint of `src/` smaller and makes barrel re-exports trivial.
**Alternatives considered.** Top-level `src/constants.ts` (one more shallow file in `src/`).

### Decision: CI runs `openspec validate --changes` on every push
**Rationale.** Catches malformed deltas (missing scenarios, wrong header levels) before merge. The CI cost is sub-second.
**Alternatives considered.** Run only on PRs touching `openspec/**` (more complex pathspec config; same effect on green branches).

## Risks / Trade-offs

- **Risk:** `tsup` and `tsc` may disagree on subtle type emission edge cases. **Mitigation:** `tsc --noEmit` runs in CI as a separate step from `tsup build`; if they diverge, CI catches it.
- **Risk:** Coverage gate (line 90 / branch 85) is empty in Phase 0 because there is barely any code, so the gate is trivially satisfied. **Mitigation:** Phase 1 onward, gate enforces real coverage; Phase 0 only seeds the config.
- **Risk:** Pinning `GRAPH_API_VERSION = "v23.0"` becomes stale. **Mitigation:** It is constructor-overridable, and bumping the constant is a one-line MODIFIED delta against `cloud-api-client/spec.md`.
- **Trade-off:** Wiring the `./express` subpath stub before Phase 8 is technically dead code. Cost is one tiny file; benefit is exports-map stability.
- **Trade-off:** Strict TS settings (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) will slow Phase 1+ slightly. Accepted; the SDK's correctness target rewards the friction.

## Migration Plan

Not applicable — first commit, no consumers yet.

## Open Questions

- Should the `./express` stub throw `Error("Not implemented in v0")` or a typed `MockModeError`-like class? **Tentative answer:** plain `Error`, since at consumption time the only consumer error is "you imported the wrong subpath in this version".
- pnpm vs npm workspace integration with the parent `agentic-frontdesk-proy/` directory. **Tentative answer:** pnpm-workspace.yaml at the parent level is out of scope for Phase 0; the package operates as a standalone repo for now and gets workspaced later when `dojo-conversation-state-mcp` and friends arrive.
