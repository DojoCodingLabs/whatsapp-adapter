## Approach

Store an optional `templates` seed on `MockWhatsAppClient`. `listTemplates` and `getTemplate` consult the seed instead of returning `{ data: [] }` / rejecting unconditionally. When the seed is empty (the default), the previous behaviour is preserved exactly.

The filter implementation is intentionally simple: in-memory `.filter()` over the seed, equality matching on `name`, `language`, `status`, `category`. `limit` truncates the result. `before` / `after` cursors are accepted (so the type signature matches the real client) but not honoured — tests that need paging should construct two instances.

## Domain rules satisfied

From `openspec/config.yaml`:

- "Mock mode (`WHATSAPP_MODE=mock`) must satisfy the same public interface as the real client and pass the same parity contract tests." — the public surface is unchanged (the registry field is additive); existing parity tests continue to pass with empty seeds.

## Alternatives considered

- **Build a fully Meta-shaped paginated mock backend.** Rejected. The mock's job is to remove the network, not to re-implement Meta's pagination semantics. Tests rarely need cursor paging.
- **Generate definitions from the seed name.** Rejected. Tests need control over which `components` and which `placeholder` counts the definition advertises; auto-generation hides that.
- **Promote `templates` to a separate setter (`mock.setTemplates([…])`).** Rejected. A constructor option is enough; tests that need to mutate can re-construct the mock. Two ways to seed the registry would split the API for no benefit.

## Tests vs registry-as-fixture

A common pattern this enables:

```ts
const seedTemplates: TemplateDefinition[] = [
  { id: "T1", name: "appt", language: "en_US", category: "UTILITY",
    status: "APPROVED",
    components: [{ type: "BODY", text: "Hi {{1}}, your appt is at {{2}}" }] },
];
const mock = new MockWhatsAppClient({
  phoneNumberId: "P", wabaId: "W", templates: seedTemplates,
});

const def = await mock.getTemplate("T1");
await mock.sendTemplate({
  to, name: def.name, language: def.language,
  components: [{ type: "body", parameters: [
    { type: "text", text: "Dani" }, { type: "text", text: "10am" }] }],
  validateAgainst: def,
});
```

This replaces the previous `vi.spyOn(mock, "getTemplate").mockResolvedValue(fixture)` boilerplate with a constructor option.
