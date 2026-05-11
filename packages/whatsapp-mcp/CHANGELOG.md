# Changelog

All notable changes to `@dojocoding/whatsapp-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 minor versions may contain breaking changes — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) § Releases.

## [Unreleased]

### Added

Skeleton for the forthcoming Phase C1 implementation. The
package's first publishable release will be `0.1.0`, shipping
the MCP server core (env-config loader, error mapper, stdio
transport wiring) plus the first 6 tools (`whatsapp_send_text`,
`whatsapp_send_image`, `whatsapp_send_template`,
`whatsapp_send_reaction`, `whatsapp_list_templates`,
`whatsapp_get_template`).

See OpenSpec change `2026-05-10-add-mcp-server` for the full
plan.
