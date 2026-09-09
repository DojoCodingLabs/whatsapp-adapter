## Why

`mcp-v0.4.0 → main` added three tools (`whatsapp_mark_as_read`, `whatsapp_upload_media_from_url`, `whatsapp_get_media_info`) in commit `cb326f0` without an OpenSpec delta. The stable `mcp-server` spec still says "exactly 16 tools", still lists `whatsapp_send_reaction` as window-exempt (the SDK gates it since the same commit), and `docs/mcp/tools.md` never documents the three tools. None of the three had a contract test.

Separately, `whatsapp_upload_media_from_url` fetches whatever URL the model supplies. `z.string().url()` accepts `http://169.254.169.254/…`, `http://localhost:…` and internal hostnames, so a prompt-injected agent could exfiltrate the bytes of an internal endpoint into Meta as a media object. Found while preparing the `mcp-v0.5.0` release.

## What Changes

- **MODIFIED** `mcp-server` requirement "Outbound tools surface": 19 tools; `whatsapp_send_reaction` is window-gated; new rows + output shapes for the three tools; new scenarios for reaction gating, `mark_as_read`, `get_media_info`, and the `upload_media_from_url` source-URL guard.
- **MODIFIED** `packages/whatsapp-mcp/src/tools/upload-media-from-url.ts`: exported `assessSourceUrl()` guard (https-only, no embedded credentials, no `localhost`/`*.local`, no loopback / unspecified / link-local / RFC 1918 / 100.64/10 IPv4 literals incl. IPv4-mapped IPv6, no IPv6 loopback / link-local / ULA); `fetch(..., { redirect: "error" })`; fetch rejections surface as `isError source_fetch_failed` instead of escaping as a raw throw.
- **ADDED** `packages/whatsapp-mcp/test/contract/media-ack-tools.test.ts` — 32 contract cases across the three tools.
- **MODIFIED** `docs/mcp/tools.md` (three new sections; "why not here" paragraph on `mark_as_read` removed), tool counts in `AGENTS.md`, `CLAUDE.md`, `MIGRATION.md`, `docs/**`, `packages/whatsapp-mcp/README.md`, `src/index.ts`, `src/toolset.ts`.

## Capabilities

### Modified Capabilities

- `mcp-server`

## Non-goals

- DNS-resolution-time private-range checks (hostname → private IP). Documented as a deployment concern (egress rules).
- Changing any of the 16 pre-existing tools' schemas.

## Impact

- **Behaviour:** `whatsapp_upload_media_from_url` now refuses `http://` and private targets it previously fetched. Anyone relying on `http://` sources must move them to `https://`. Called out in the MCP CHANGELOG.
- **Risk:** low; additive tests, defensive guard.
