// Capability: framework-adapters (Phase 8). The real Express adapter lives at
// the `./express` subpath export and is loaded directly via
// `@dojocoding/whatsapp-sdk/express`. This barrel is intentionally empty — the
// root `@dojocoding/whatsapp-sdk` import surface does not export framework
// adapters to keep the core framework-agnostic.
export {};
