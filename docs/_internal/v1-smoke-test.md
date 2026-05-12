# v1.0.0 — live Meta smoke test

The one signal the contract suite cannot give. Before tagging
`sdk-v1.0.0` + `mcp-v1.0.0`, send exactly one real WhatsApp
template through the real `WhatsAppClient` against a real
Meta WABA. Record the resulting `wamid` + Meta-side delivery
status in the "Results" section at the bottom of this file.

This page is **internal** by convention — not linked from
`docs/README.md`. The signed-off-on `wamid` is added to the
`sdk-v1.0.0` CHANGELOG entry as the production-validated
shipping evidence.

## 1. Prerequisites (Meta side, ~30 min)

1. **Create a Meta app** at <https://developers.facebook.com/apps>:
   - Type: "Other" → "Business"
   - Add the **WhatsApp** product to the app.
2. **WhatsApp → API Setup** screen now shows:
   - A test phone number (Meta-provided; you don't own it).
   - The phone number id for that test number.
   - A 24-hour temporary access token.
   - The WhatsApp Business Account id (WABA id).
3. **Verify your recipient phone** in the "To" section — Meta
   only delivers to verified numbers until business
   verification completes. Tap "Send code" → enter the SMS
   code Meta sends to the recipient phone.
4. **(Recommended for permanent setup)** Business Settings →
   System Users → create a System User → Generate New Token
   → scope `whatsapp_business_messaging` + `whatsapp_business_management`
   → assign the WABA. Use this token instead of the 24-hour
   temp token for anything past the smoke run.

Note: the `hello_world` template is pre-approved by Meta on
every new WABA. You don't need to create or submit a template
for this smoke test.

## 2. Set env vars

```bash
export WHATSAPP_ACCESS_TOKEN="EAAG..."            # the API Setup token
export WHATSAPP_PHONE_NUMBER_ID="1234567890"       # from API Setup screen
export WHATSAPP_BUSINESS_ACCOUNT_ID="9876543210"   # from API Setup screen
export WHATSAPP_APP_SECRET=""                      # not needed for outbound; leave empty
export SMOKE_TO="+5210000000001"                   # the verified recipient phone
```

(Or drop into a private `.env.smoke` file and `source` it.)

## 3. Run the smoke script

From the workspace root:

```bash
WHATSAPP_ACCESS_TOKEN=$WHATSAPP_ACCESS_TOKEN \
WHATSAPP_PHONE_NUMBER_ID=$WHATSAPP_PHONE_NUMBER_ID \
WHATSAPP_BUSINESS_ACCOUNT_ID=$WHATSAPP_BUSINESS_ACCOUNT_ID \
SMOKE_TO=$SMOKE_TO \
node docs/_internal/v1-smoke-script.mjs
```

The script lives at `docs/_internal/v1-smoke-script.mjs` and is
included verbatim below — it's the only piece of executable
code in this workflow. It:

1. Constructs a real `WhatsAppClient` from `@dojocoding/whatsapp-sdk`.
2. Sends the `hello_world` template (en_US) to `$SMOKE_TO`.
3. Prints the resulting `wamid` to stdout.
4. Exits 0 on success, non-zero on any error.

Read the script before running. Total runtime ~1.5 seconds.

## 4. Expected output

```
$ node docs/_internal/v1-smoke-script.mjs
[smoke] sending hello_world (en_US) to +5210000000001 via PNID 1234567890
[smoke] SUCCESS — wamid=wamid.HBgL...  recipient=+5210000000001  template=hello_world  language=en_US
[smoke] check your recipient phone for the delivered message
```

The `wamid.HBgL...` prefix indicates a real Meta-issued
identifier (the mock would prefix `wamid.mock-`). Check the
recipient phone — the `hello_world` template should appear
within seconds.

## 5. Record evidence

Once the message lands on the recipient phone:

1. Screenshot the message on the recipient device.
2. Save the screenshot privately (this repo is open source; a
   recipient phone number is PII — don't commit the screenshot).
3. Paste the `wamid` into the "Results" section below.
4. Paste the timestamp + sender phone-number-id.

Then commit this file (with the Results section filled but
WITHOUT the screenshot) and proceed to cut the v1.0.0 tags.

## 6. What this proves

That `sdk-v0.9.0` end-to-end:

- Constructs a `WhatsAppClient` against real Meta credentials.
- Resolves the bearer token and reaches `graph.facebook.com`.
- Sends a real wire payload through the SDK's HTTP transport.
- Parses Meta's real response shape.
- Returns a real `wamid` to the caller.

The contract suite at 603 tests is 100% MSW-mocked — every
`graph.facebook.com` request is intercepted before leaving the
process. No MSW configuration mistake can mask the one signal
this smoke run gives: that the SDK actually talks to Meta and
gets back something Meta sent.

---

## Results

(Fill in after running.)

| Field                                 | Value     |
| ------------------------------------- | --------- |
| `wamid`                               | _to fill_ |
| Recipient (last-4 only)               | _to fill_ |
| Sender `phone_number_id`              | _to fill_ |
| Run timestamp (UTC)                   | _to fill_ |
| Run by                                | _to fill_ |
| Notes (Meta-side delivery confirmed?) | _to fill_ |

Once filled, the `wamid` (last 12 chars only — full one is PII)
goes into the `sdk-v1.0.0` CHANGELOG entry as the
production-validated shipping evidence. Same for `mcp-v1.0.0`
(the MCP server runs the SDK underneath, so the SDK smoke run
covers both — no need to re-run via stdio).
