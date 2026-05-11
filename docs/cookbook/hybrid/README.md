# Hybrid cookbook — SDK + MCP together

These recipes are the showcase for using
`@dojocoding/whatsapp-sdk` and `@dojocoding/whatsapp-mcp`
together in one process. Start here when you're building a
production application that does both (a) agent-driven outbound
and (b) server-side inbound — which is most non-trivial
WhatsApp deployments.

For the package-level "should I use both?" decision, see
[`../../when-to-use-which.md`](../../when-to-use-which.md). For
the per-call "SDK or MCP for this send?" decision tree, see the
same doc's "Per-call decision inside the orchestrator" section.

## The recipes

- **[`orchestrator-process-layout.md`](./orchestrator-process-layout.md)** —
  the plumbing scaffold. One `WhatsAppClient` instance; three
  caller paths (your code / MCP agent / HITL operator) sharing
  window tracker + dedupe + OTel + rate-limit queue. Read this
  first if you're building a Front-Desk-style application.
- **[`agent-handoff-loop.md`](./agent-handoff-loop.md)** — the
  canonical full loop: agent triggers outbound template via MCP
  → customer reply lands at SDK webhook receiver → app routes
  reply back into agent runtime.
- **[`inbound-routed-to-agent.md`](./inbound-routed-to-agent.md)** —
  SDK receives inbound → intent classifier routes to MCP-driven
  agent for follow-up. Cost-conscious alternative to
  agent-on-every-inbound.
- **[`compliance-broadcast.md`](./compliance-broadcast.md)** —
  agent triggers marketing-template broadcast via MCP;
  server-side consent-ledger gate enforced via a
  `WhatsAppLikeClient` wrapper. The general pattern for any
  cross-cutting policy that needs to gate agent sends.
