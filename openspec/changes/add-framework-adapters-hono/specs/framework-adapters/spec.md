## ADDED Requirements

### Requirement: whatsappHandler returns a Hono Handler

The package SHALL export `whatsappHandler(receiver, options?)` from
`@dojocoding/whatsapp/hono`. The return value SHALL be a Hono
`Handler` (`(c: Context) => Promise<Response>`) that delegates to
`createWhatsAppHandler(receiver, options)` from
`@dojocoding/whatsapp/web`. The handler SHALL be mountable as
`app.all(path, whatsappHandler(receiver))` and SHALL handle the
same verbs the web core handles: GET (verify-token handshake), POST
(event receiver), 405 for all other verbs.

#### Scenario: Hono handler echoes the challenge on valid handshake

- **WHEN** a Hono app is built with `app.all("/webhook",
  whatsappHandler(receiver))` and a GET request with
  `hub.mode=subscribe`, a matching `hub.verify_token`, and
  `hub.challenge=1234` is sent via `app.request("/webhook?...")`
- **THEN** the response is `200` with body `"1234"` and
  `content-type: text/plain`

#### Scenario: Hono handler returns 403 on wrong verify token

- **WHEN** the GET request has a `hub.verify_token` that does not
  match the receiver's expected token
- **THEN** the response is `403`

#### Scenario: Hono handler dispatches on a valid signature

- **WHEN** a POST is sent through the Hono app with a body whose
  `X-Hub-Signature-256` is correctly computed and a registered
  `message` handler exists
- **THEN** the response is `200` (resolved before the handler runs)
  AND the handler is invoked exactly once with the parsed
  `MessageEvent`

#### Scenario: Hono handler returns 401 on a tampered body

- **WHEN** the body is altered after the signature was computed
- **THEN** the response is `401` AND no registered handler is invoked

#### Scenario: Hono handler returns 405 on other verbs

- **WHEN** any verb other than `GET` or `POST` is sent
- **THEN** the response is `405` AND the `Allow` header is
  `GET, POST`

### Requirement: Hono is an optional peer dependency

The package SHALL declare `hono` as an optional peer dependency
(`peerDependenciesMeta.hono.optional = true`). The Hono adapter
subpath SHALL NOT bundle `hono` itself; the build SHALL mark `hono`
as external. Consumers who do not import `@dojocoding/whatsapp/hono`
SHALL NOT see `hono` introduced into their dependency tree.

#### Scenario: Hono is not bundled into the published artefact

- **WHEN** the package is built (`pnpm build`) and the resulting
  `dist/adapters/hono/index.cjs` is inspected
- **THEN** the file contains a `require("hono")` reference (or the
  ESM equivalent), not the inlined Hono runtime
- **AND** the file size is under 1 KB

#### Scenario: Consumers without the Hono subpath do not install Hono

- **WHEN** a consumer installs `@dojocoding/whatsapp` and only
  imports from `@dojocoding/whatsapp` or `@dojocoding/whatsapp/web`
  or `@dojocoding/whatsapp/express`
- **THEN** their package manager does not warn about a missing
  `hono` peer (peerDependenciesMeta marks it optional)
