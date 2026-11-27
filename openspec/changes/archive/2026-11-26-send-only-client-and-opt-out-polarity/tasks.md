## 1. Opt-out polarity and es-CR recall

- [x] 1.1 Failing tests: negated stops, price talk, polite suffixes, "no quiero/deseo recibir …", "elimine mi número"
- [x] 1.2 Negation guard, polite-edge stripping, new patterns in `src/reply/opt-out.ts`

## 2. Send-only client

- [x] 2.1 Failing tests: construct without `wabaId`; `listTemplates` rejects with `MissingCredentialsError(["wabaId"])`; mock parity
- [x] 2.2 Make `wabaId` optional on `WhatsAppClient` and `MockWhatsAppClient`; guard `listTemplates`
- [x] 2.3 Docs (`docs/sdk/client.md`, `docs/sdk/reply.md`) and CHANGELOG
