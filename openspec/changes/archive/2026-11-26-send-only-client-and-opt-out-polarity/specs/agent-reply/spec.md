## MODIFIED Requirements

### Requirement: detectOptOut recognises short typed opt-outs without copy

The SDK SHALL export `detectOptOut(text)` returning `"es"`, `"en"` or `null`. Text SHALL be normalized (NFD, accents removed, lower case, punctuation to spaces). Normalized text longer than 80 characters SHALL return `null`. A negated stop ("no", "nunca" or "jamás" followed by "deje(n)/deja(n) de") SHALL return `null`. Courtesy words at the start or end ("por favor", "porfa", "gracias", "please", "thanks") SHALL be ignored before matching. The SDK SHALL NOT ship acknowledgement copy. Documentation SHALL state that Meta's `user_preferences` webhook and error `131050` stay authoritative for marketing opt-out.

#### Scenario: Spanish and English requests

- **WHEN** `detectOptOut` receives `"No me escriban más"` or `"Baja!"`
- **THEN** it returns `"es"`
- **AND** for `"please stop messaging me"` it returns `"en"`

#### Scenario: Ordinary or long messages

- **WHEN** `detectOptOut` receives `"baja de ventas en la app"` or a 100-character story containing "no me escriban"
- **THEN** it returns `null`

#### Scenario: Negated stop keeps the customer subscribed

- **WHEN** `detectOptOut` receives `"no deje de enviarme información"` or `"nunca dejen de escribirme"`
- **THEN** it returns `null`

#### Scenario: Price talk is not an opt-out

- **WHEN** `detectOptOut` receives `"baja de precio"` or `"¿Hay baja de precio?"`
- **THEN** it returns `null`

#### Scenario: es-CR usted phrasings and courtesy words

- **WHEN** `detectOptOut` receives `"Baja por favor"`, `"No quiero recibir más mensajes"` or `"Por favor elimine mi número"`
- **THEN** it returns `"es"`
