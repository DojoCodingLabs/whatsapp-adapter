## Why

Site2Print integration feedback (2026-11-26) found two gaps in 0.11.0:

1. `detectOptOut` treated double negatives as opt-outs. "no deje de enviarme información" means *keep* sending, but it returned `"es"`. A false opt-out silently stops messaging a customer who wants it. Recall was also short for common es-CR (usted) phrasings: "baja por favor" and "no quiero recibir más mensajes" were missed.
2. A send-only client (no template management) still had to supply `wabaId`. Sends, media, read receipts and webhooks address the phone number id. Only `/{waba-id}/message_templates` needs the WABA.

## What Changes

- `detectOptOut`:
  - Returns `null` for negated stops ("no/nunca deje(n) de …").
  - Ignores courtesy words at the edges ("por favor", "gracias", "please").
  - Recognises "no quiero / no deseo recibir (más) mensajes / información / promociones / publicidad / notificaciones / ofertas" and "elimine(n) mi número".
  - "baja de precio" stays `null`.
- `WhatsAppClientOptions.wabaId` and `MockWhatsAppClientOptions.wabaId` become optional. `client.wabaId` stays a `string` (`""` when unset). `listTemplates` rejects with `MissingCredentialsError(["wabaId"])` when it is unset.

Not breaking for callers that pass `wabaId`. Code that relied on construction throwing for an empty `wabaId` now gets the error from `listTemplates` instead.

## Impact

- Specs: `cloud-api-client` (construction, credential validation) and `agent-reply` (`detectOptOut`).
- Code: `src/reply/opt-out.ts`, `src/client/whatsapp-client.ts`, `src/templates/api.ts`, `src/mock/{client,types}.ts`.
