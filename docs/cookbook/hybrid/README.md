# Hybrid cookbook — SDK + MCP together (placeholder)

The recipes here are the showcase for using
`@dojocoding/whatsapp-sdk` and `@dojocoding/whatsapp-mcp`
together. They land in Phase C3 of OpenSpec change
`2026-05-10-add-mcp-server`:

- `agent-handoff-loop.md` — agent triggers outbound template via
  MCP → customer reply lands at SDK webhook receiver → app routes
  reply back into agent runtime. The canonical full loop.
- `inbound-routed-to-agent.md` — SDK receives inbound → intent
  classifier routes to MCP-driven agent for follow-up.
- `compliance-broadcast.md` — agent triggers marketing-template
  broadcast via MCP; server-side consent-ledger gate enforced
  via SDK middleware.

Until then, see the proposal under
[`openspec/changes/2026-05-10-add-mcp-server/`](../../../openspec/changes/2026-05-10-add-mcp-server/).
