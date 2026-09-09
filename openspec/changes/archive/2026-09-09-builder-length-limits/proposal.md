# Change proposal — pre-flight Meta's character limits in the free-form builders

Affected capability: `message-builders`.

## Why

Audit finding F23. The builders validated presence and shape but not
Meta's documented hard character limits (text body 4096, caption 1024,
interactive body 1024, footer 60, text header 60, reply-button title
20, list button 20, section / row title 24, row description 72, …).
Over-long strings round-tripped to Meta and came back as code `100` /
`131009` → `CapabilityError`, one full HTTP call later. The LLM
orchestrator use case generates over-long text routinely, and a
pre-flight failure that names the offending field is both cheaper and
far more actionable for the model.

## What changes

- New exported constant `MESSAGE_LENGTH_LIMITS` in
  `src/types/constants.ts` pinning the thirteen documented ceilings.
- `buildText`, the media builders (`caption`), `buildInteractiveButton`,
  `buildInteractiveList` and `buildInteractiveCtaUrl` enforce the
  applicable limits before returning, throwing `WhatsAppError("UNKNOWN")`
  whose message names the field (including array index for buttons /
  sections / rows) and the limit. Media (non-text) interactive headers
  are not length-checked.
- Lengths are counted in Unicode code points (`[...s].length`), the
  lenient reading of Meta's "characters", so emoji-heavy bodies are not
  over-rejected.
- `docs/sdk/messages.md` gains a "Length limits (pre-flight)" table and
  a truncation snippet.

## Non-goals

- Template parameter text lengths (Meta enforces per-template
  variable limits at approval time; the SDK cannot know them without
  the definition).
- Location `name` / `address`, document `filename`, contact fields —
  Meta documents no hard ceiling for these.
