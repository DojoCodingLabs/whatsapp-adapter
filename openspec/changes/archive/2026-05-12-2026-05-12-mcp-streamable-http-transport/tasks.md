## 1. Phase 1 — `createWhatsAppHttpHandler` implementation

- [ ] 1.1 Add `packages/whatsapp-mcp/src/http.ts` with:
  - `CreateWhatsAppHttpHandlerInput` interface (client, wabaPhoneNumberId, windowTracker?, serverVersion?, sessionIdGenerator?, stateless?, staticToken?, verifyToken?).
  - `WhatsAppHttpHandler = (req: Request) => Promise<Response>`.
  - `createWhatsAppHttpHandler(input)` factory: instantiate `WhatsAppMcpServer` (via `buildServer`), instantiate `WebStandardStreamableHTTPServerTransport`, `server.connect(transport)`, return a closure.
- [ ] 1.2 Inside the closure: extract `Authorization: Bearer <token>`. Apply auth pipeline (verifyToken first, then staticToken, else pass-through). On auth failure, return `Response` with status 401, `Content-Type: application/json`, body `{ jsonrpc, id: null, error: { code: -32001, message: "Unauthorized" } }`.
- [ ] 1.3 On auth success, delegate to `transport.handleRequest(req, { authInfo })`.
- [ ] 1.4 Implement constant-time compare for static-token equality (manual constant-time XOR; Web-Crypto-only with no Node-API deps so it runs on Workers/Deno/Bun).
- [ ] 1.5 Re-export `AuthInfo` from `@modelcontextprotocol/sdk/server/auth/types.js` via the package root for consumer convenience.

## 2. Phase 2 — exports + drift detection

- [ ] 2.1 Add `createWhatsAppHttpHandler`, `CreateWhatsAppHttpHandlerInput`, `WhatsAppHttpHandler`, and `AuthInfo` to `packages/whatsapp-mcp/src/index.ts`.
- [ ] 2.2 Update `packages/whatsapp-mcp/test/contract/public-surface.test.ts` `EXPECTED_EXPORTS` to include the new name.
- [ ] 2.3 Extend (or sibling) `packages/whatsapp-mcp/test/contract/embedded-toolset-parity.test.ts`: also assert HTTP-handler `tools/list` (via in-process Fetch round-trip) matches the toolset and the stdio server byte-for-byte. Adding a tool to one path without the others fails CI.

## 3. Phase 3 — auth contract tests

- [ ] 3.1 Add `packages/whatsapp-mcp/test/contract/http-handler-auth.test.ts`:
  - No auth set + no Authorization header → request proceeds.
  - `staticToken` set + matching Bearer → request proceeds.
  - `staticToken` set + missing header → 401 JSON-RPC body.
  - `staticToken` set + wrong token → 401 JSON-RPC body.
  - `staticToken` set + correctly-prefixed but wrong-bytes token → constant-time compare returns false (assert: no observable timing leak via running 100 mismatches and checking variance is reasonable).
  - `verifyToken` returns null → 401 JSON-RPC body.
  - `verifyToken` returns AuthInfo → request proceeds.
  - `verifyToken` AND `staticToken` both set: verifyToken takes precedence.
  - Auth precedes transport delegation: a bad-auth POST never invokes `transport.handleRequest`.

## 4. Phase 4 — protocol-roundtrip tests

- [ ] 4.1 Add `packages/whatsapp-mcp/test/contract/http-handler-roundtrip.test.ts`:
  - Initialize handshake: client → server → capabilities response including tools/resources/prompts.
  - `tools/list` returns the 16 expected names.
  - `tools/call whatsapp_send_text` round-trips with `structuredContent.messageId` matching `^wamid\.mock-\d+$`.
  - `resources/list` returns the 2 resources.
  - `resources/read whatsapp://templates` returns the cached body.
  - `prompts/list` returns the 1 prompt.
  - `prompts/get wa-template-send` returns the rendered messages.
  - Error path: `tools/call whatsapp_unknown` returns `isError: true` with `unknown_tool` code — same shape as the toolset and the stdio server.

  Test infrastructure: a small `runOverHttp(handler, request)` helper that wraps the MCP SDK's `Client` against the handler via a `fetch` proxy.

## 5. Phase 5 — docs

- [ ] 5.1 New `docs/mcp/http.md` — HTTP-handler reference. API surface, when to use (vs stdio vs embedded toolset), the two auth modes, the 401 JSON-RPC error shape, stateful vs stateless trade-offs, runtime support matrix (Workers / Vercel / Bun / Deno / Node 18+).
- [ ] 5.2 New cookbook `docs/cookbook/mcp/streamable-http-vercel.md` — end-to-end Vercel Functions recipe with a `jose`-based JWT verifier in `verifyToken`. Includes the `app/api/mcp/route.ts` shape and Meta CAPI handoff if needed.
- [ ] 5.3 Update `docs/mcp/transports.md`:
  - Streamable HTTP moves from "🔮 Planned (v2)" to "✅ Shipped (v1.1)" in the matrix.
  - The "v2 (planned): Streamable HTTP" section is replaced with a "Streamable HTTP" reference section pointing at the new docs.
  - The "Hookdeck MCP Gateway pattern" note is moved to the embedded-toolset doc as the older workaround.
- [ ] 5.4 Update `docs/mcp/README.md` index to surface the new HTTP page.
- [ ] 5.5 Update `docs/compatibility.md` MCP host compatibility section: HTTP handler runs on every runtime supporting the Fetch API.

## 6. Phase 6 — ship as part of `mcp-v1.1.0`

- [ ] 6.1 Land the change on `main`. Archive: `openspec archive 2026-05-12-mcp-streamable-http-transport`.
- [ ] 6.2 Coordinated `mcp-v1.1.0` release bundles this with any other Phase B MCP changes.
- [ ] 6.3 Bundle-size budget check: dist/index.js + dist/index.cjs (library) stay well under 200 KB brotlied. Expected delta <5 KB.
- [ ] 6.4 Manual smoke: boot the handler via Vercel `vercel dev` against a real `WhatsAppMcpServer`-equivalent flow, send `tools/call whatsapp_send_text` from a curl `Authorization: Bearer ...` invocation; confirm round-trip.
