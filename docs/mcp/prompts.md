# Prompts

The MCP server registers one prompt: **`wa-template-send`**.
Prompts surface in MCP-host UI as slash commands — in Claude
Desktop, `/wa-template-send` appears in the prompt picker.

## `wa-template-send`

A guided walkthrough that picks an approved template, asks for
variables, and sends. Use this when the customer is out of the
24-hour window or you need to kick off a fresh conversation.

### Arguments

Both optional. MCP transmits all prompt arguments as strings.

| Name             | Type            | Notes                                       |
| ---------------- | --------------- | ------------------------------------------- |
| `templateName`   | string?         | if omitted, the model lists templates first |
| `recipientPhone` | string? (E.164) | if omitted, the model asks                  |

### What it emits

A single user-role message instructing Claude to:

1. **If `templateName` is missing:** read the `whatsapp://templates`
   resource and present the available options.
2. **Always:** call `whatsapp_get_template` to inspect the chosen
   template's `components` and learn the variable slots.
3. **If `recipientPhone` is missing:** ask the user for the phone
   in E.164 format.
4. **Always:** ask the user for each variable value, one at a
   time. Confirm the final shape.
5. Call `whatsapp_send_template` with the gathered values.
   Report the returned `messageId`.

The exact wording adapts to which arguments were pre-filled.
With both `templateName` and `recipientPhone` provided, steps
1 and 3 are skipped.

### Example invocations

In Claude Desktop's prompt picker:

```
/wa-template-send
```

Triggers the full walkthrough. Claude lists templates first.

```
/wa-template-send templateName=summer_sale
```

Skips the listing step; Claude immediately fetches the
`summer_sale` template and asks for variables + recipient.

```
/wa-template-send templateName=summer_sale recipientPhone=+5210000000001
```

Skips listing and recipient prompting; Claude only asks for the
template variables.

### Why this is a prompt, not a tool

Prompts in MCP exist to put a **canned user message** into the
conversation. They don't execute logic themselves — they just
inject a templated instruction the model then acts on. That fits
this case perfectly: the prompt's role is to orient Claude
toward a multi-step workflow ("read this resource → call this
tool → ask the user → call that tool") that would otherwise
require the user to type all five steps themselves.

If you want to invoke `whatsapp_send_template` directly without
the guided flow, just call the tool — the prompt is purely UX.

## Constants

```ts
import { WA_TEMPLATE_SEND_PROMPT } from "@dojocoding/whatsapp-mcp";
// → "wa-template-send"
```

## What's not here

- **`wa-reply-quickly`**: a tempting addition for "draft a reply
  to this customer", but the prompt would need an `inReplyTo`
  wamid that only exists on the inbound side. Defer with the
  rest of inbound surface.
- **`wa-broadcast`**: tempting for "send this template to a list
  of customers", but multi-recipient fan-out is a server-side
  concern — the SDK's `RateLimitedQueue` is the right primitive.
  Wire it in your application; don't drive bulk sends through
  the MCP transcript.
- **Prompts that reference observability hooks, custom storage,
  retry policy, etc.** — those are SDK concerns, configured at
  `WhatsAppClient` construction time, not via runtime prompts.
