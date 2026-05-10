## Approach

Bump the pinned default `GRAPH_API_VERSION` constant from `"v23.0"` to `"v25.0"`, leave the override mechanism untouched. The change is a single-line code edit plus mechanical test / spec / doc updates following the literal.

## Domain rules satisfied

From `openspec/config.yaml`:

- "Pin Graph API version (currently v23.0); make it constructor-overridable." — the pin is preserved (just at a newer version), and the constructor override remains the only way to deviate.

## Alternatives considered

- **Track Meta's cadence automatically (compute "latest" from a manifest).** Rejected. The pin's value is auditability — knowing exactly which Graph version every send hit. A floating "latest" undermines that.
- **Bump straight to whichever version Meta releases next (v26.0 if announced).** Rejected as speculative; v25.0 is the current latest documented at change-authoring time.
- **Keep v23.0 and bump only when a v24+ feature is needed.** That's the rationale that landed v23.0 originally. The argument against keeping it is that new consumers should not inherit a stale default, and the cost of bumping (tests + specs + docs) compounds the longer it's deferred.

## Migration path for consumers

A consumer running against v23.0 today will start hitting v25.0 after upgrading. Two safety nets:

1. **Constructor override:** `new WhatsAppClient({ ..., graphApiVersion: "v23.0" })` keeps them on v23.0 until they're ready to retest.
2. **Graph API stability:** Meta supports versions for ≥ 2 years; behaviour for the documented endpoints this SDK uses is forwards-compatible across v23 → v25.
