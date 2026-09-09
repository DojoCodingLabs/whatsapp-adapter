## ADDED Requirements

### Requirement: Status events surface Meta's pricing envelope

For every entry in `entry[i].changes[i].value.statuses[i]` the parser SHALL emit a `StatusEvent` and, **when present in the payload and of the expected primitive type**, lift the following fields verbatim:

- `pricing.category` → `pricingCategory: string`
- `pricing.type` → `pricingType: string` (Meta values: `regular`, `free_customer_service`, `free_entry_point`)
- `pricing.pricing_model` → `pricingModel: string` (Meta values: `PMP`, `CBP`)
- `pricing.billable` → `billable: boolean`
- `conversation.id` → `conversationId: string`

When a source field is absent or not of the expected type, the corresponding `StatusEvent` key SHALL be omitted (not present with value `undefined`). The parser SHALL NOT throw on unrecognised `pricing` shapes and SHALL NOT constrain the string fields to a closed union, because Meta has added values without a version bump.

#### Scenario: Per-message-pricing status lifts every pricing field

- **GIVEN** a `statuses[0]` with `pricing: { billable: false, pricing_model: "PMP", category: "service", type: "free_customer_service" }` and no `conversation` object
- **WHEN** `parseWebhookPayload(...)` is called
- **THEN** the `StatusEvent` has `pricingModel === "PMP"`, `pricingCategory === "service"`, `pricingType === "free_customer_service"`, `billable === false`
- **AND** `conversationId` is `undefined`

#### Scenario: Legacy conversation-based-pricing status still parses

- **GIVEN** a `statuses[0]` with `conversation: { id: "conv-1" }` and `pricing: { billable: true, pricing_model: "CBP", category: "utility" }`
- **WHEN** the payload is parsed
- **THEN** `conversationId === "conv-1"`, `pricingModel === "CBP"`, `pricingCategory === "utility"`, `billable === true`
- **AND** `pricingType` is `undefined`

#### Scenario: Status without a pricing object omits the pricing keys

- **GIVEN** a `statuses[0]` of `status: "failed"` with `errors[]` and no `pricing` key
- **WHEN** the payload is parsed
- **THEN** `"pricingType" in event`, `"pricingModel" in event` and `"billable" in event` are all `false`
