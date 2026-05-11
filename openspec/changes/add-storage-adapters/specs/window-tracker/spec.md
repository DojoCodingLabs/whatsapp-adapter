## ADDED Requirements

### Requirement: WindowTracker works against any Storage backend

The `WindowTracker` capability is documented as taking a `Storage` instance, but until now `InMemoryStorage` was the only implementation. With `createRedisStorage` and `createPostgresStorage` now shipping alongside, the `WindowTracker` SHALL produce byte-identical observable behaviour regardless of which `Storage` implementation backs it.

In multi-process deployments, single-process backends (`InMemoryStorage`) produce different `isWindowOpen` answers across processes, silently violating the 24-hour-window contract. Documentation SHALL recommend a shared backend (Redis or Postgres) for any deployment with more than one Node process.

#### Scenario: WindowTracker behaviour parity across backends

- **WHEN** the same sequence of `notifyInbound` and `isWindowOpen` calls is issued against a `WindowTracker` configured with `InMemoryStorage`, `createRedisStorage(client)`, or `createPostgresStorage(client)`
- **THEN** the boolean returned by `isWindowOpen` is identical across all three configurations for every input
- **AND** TTL expiry follows the same wall-clock boundary

#### Scenario: Multi-process documentation recommendation

- **WHEN** the consumer reads `docs/storage.md` or `docs/window.md`
- **THEN** the docs explicitly state that `InMemoryStorage` is NOT safe for multi-process deployments
- **AND** the docs link to `createRedisStorage` and `createPostgresStorage` as the supported shared-backend options
