// Capability: opt-in-registry. Pluggable consent-state
// primitive for template-send pre-flight gating.
//
// The `TemplateCategory` literal type used here is identical
// to the loose one in `templates/types.ts` for the three
// known Meta values. We intentionally do NOT re-export it
// from this barrel — consumers import `TemplateCategory`
// from the package root (which resolves to the templates'
// version with the forward-compat `(string & {})` branch).

export { InMemoryOptInRegistry } from "./in-memory.js";
export type { OptInMeta, OptInQuery, OptInRegistry, OptOutOptions } from "./types.js";
