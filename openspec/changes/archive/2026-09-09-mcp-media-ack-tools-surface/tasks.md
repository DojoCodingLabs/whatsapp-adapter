## 1. Spec

- [x] 1.1 `mcp-server` delta: 19 tools, reaction gated, three new rows, output shapes, six new scenarios.

## 2. Code

- [x] 2.1 `assessSourceUrl()` guard in `upload-media-from-url.ts`; `redirect: "error"`; fetch rejection → `isError source_fetch_failed`.
- [x] 2.2 Input-schema description for `sourceUrl` states the constraints.

## 3. Tests

- [x] 3.1 `test/contract/media-ack-tools.test.ts`: mark_as_read (4), get_media_info (2), guard table (15 refuse + 5 accept), guard-via-tool (2), fetch+upload (4).

## 4. Docs

- [x] 4.1 `docs/mcp/tools.md`: sections for the three tools; remove the stale "mark_as_read isn't here" paragraph; count 19.
- [x] 4.2 Tool count 16 → 19 in `AGENTS.md`, `CLAUDE.md`, `MIGRATION.md`, `docs/README.md`, `docs/mcp/*.md`, `docs/cookbook/mcp/*.md`, `packages/whatsapp-mcp/README.md`, `src/index.ts`, `src/toolset.ts`.
