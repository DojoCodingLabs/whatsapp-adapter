# Design — realign the Meta error taxonomy (Nov 2026)

## Chosen approach

`mapMetaError` stays a pure code → class lookup, with one new code
set and a few additions to the existing sets. All wording below comes
from Meta's error-code reference
(`/documentation/business-messaging/whatsapp/support/error-codes`).
`131065` is the exception: it comes from the Marketing Messages
changelog (Oct 5, 2026).

| Set | Codes | Class | Retried |
| --- | --- | --- | --- |
| Retryable throttle | 4, 80007, 130429, 131056 | `RateLimitError` | yes |
| Non-retryable throttle | 131048, 131049, 131064, 131066, 133016 | `RateLimitError` | no |
| **Temporary (new)** | 1, 2, 131000, 131016, 131057, 133004, 2494100 | `TransientError({ metaCode, httpStatus })` | yes |
| Account restricted | 368, 130497, 131031, **131042, 33, 131037, 131045, 133010** | `AccountRestrictedError` | no |
| Recipient blocked | **130403** | `UndeliverableError({ reason: "RECIPIENT_BLOCKED" })` | no |
| Auth | 0, 190, **200** | `AuthenticationError` | no |
| Permission | 3, 10, 131005, **201–299 (range)** | `PermissionError` | no |
| Capability | 100, 131008, 131009, 131051–131053, **131021, 131063, 131065** | `CapabilityError` | no |
| Template | 132000–132999, **134102** | `TemplateError` | no |

### Why the account-config codes are `AccountRestrictedError`

Meta's text for these codes:

- `33`: "The business phone number has been deleted."
- `131037`: "555 number … does not have an approved display name."
- `131045`: "phone number registration error."
- `133010`: "Phone number not registered on the WhatsApp Business Platform."

Each one describes the sending number, not the request. Every send
from that number fails until an operator changes something in
WhatsApp Manager. That is exactly the consumer action
`AccountRestrictedError` documents: halt the campaign and page an
operator. `CapabilityError` means "fix this call site", which is
wrong here, because no change to the payload helps. `131042`
("error related to your payment method. Review your billing setup")
follows the same reasoning. Its class JSDoc now names the
integrity, billing and number-configuration groups.

`131021` (sender = recipient), `131063` (marketing templates disabled
on Cloud API: use the MM API or re-enable) and `131065` (max price
unavailable for the country) are problems with this particular
request or endpoint, so they map to `CapabilityError`.

### Why `130403` reuses `UndeliverableError`

Meta: "Unable to deliver the message. This business has blocked the
end user on WhatsApp", and "do not retry". The consumer's branch is
the same as for `131026`: a template will not help, so stop sending
to this recipient. Reusing the class keeps existing
`instanceof UndeliverableError` handlers correct. The new `reason`
discriminator separates the two cases. The `RECIPIENT_BLOCKED`
message omits the recipient (privacy rule for new code), but
`customerWaId` still carries it, as it already does for `131026`.

### Temporary codes go through the retry marker

`doFetch` throws `TransientHttpError(status, metaCode)` for a
temporary code on any status. The existing loop and `toPublicError`
then produce `TransientError({ httpStatus, attempts, metaCode })`, so
no retry logic is reimplemented. `isRetryableError` also returns true
for a `TransientError` carrying a temporary `metaCode`, so custom
shims stay consistent. `1` is "conditional" in Meta's table ("check
the status page; if no outage, verify the request"). The retry budget
is ≤ 4 attempts / ≤ 8 s, so a malformed request costs only a few
extra calls. As before, an exhausted `TransientError` on
`POST /messages` is unknown-state (`131000` in particular may have
been sent).

### Envelope first on retryable statuses

```
non-2xx ─▶ body is Meta envelope?
            ├─ no  ─▶ 408/429/5xx ? TransientHttpError : mapMetaError (UNKNOWN)
            └─ yes ─▶ mapped = mapMetaError(status, body)
                       ├─ TransientError, or retryable throttle on 408/429/5xx ─▶ TransientHttpError(metaCode)
                       ├─ 4xx, or typed (≠ UNKNOWN) on 408/429/5xx ─▶ throw mapped (+Retry-After for RateLimitError)
                       └─ UNKNOWN on 408/429/5xx ─▶ TransientHttpError (unchanged behaviour)
```

A 4xx carrying a retryable throttle (e.g. `131056` on 400) is still
thrown as `RateLimitError`, and the loop retries it via
`isRetryableError`, as before.

### Throughput bucket

Meta (throughput page): "up to 80 mps by default per registered
business phone number … includes inbound and outbound". Coexistence
numbers are fixed at 20 mps. One decorator wraps one client, so the
key change does not alter behaviour within a decorator. The visible
changes are the option name (`perPhone`, with `perWaba` as a
deprecated alias where `perPhone` wins when both are set), a new
hashed span attribute, and docs that tell consumers to leave headroom
for inbound traffic.

Domain rules satisfied: errors stay typed `WhatsAppError` subclasses
with no `any`; `waba_id ≠ phone_number_id` (the bucket now uses the
right one); OTel attributes are hashed; mock parity is unchanged
(the mock does not simulate Meta codes).

Alternatives considered:

- A new `RecipientBlockedError` class. Rejected because it would
  break existing `UndeliverableError` handlers for an identical
  action.
- `PermissionError` for the number-config codes. Rejected because
  the token's scope is fine and the number is what's broken.
- Retrying `131048` once with a long delay. Rejected: Meta gives no
  retry guidance for it, and the queue is the right place to wait.
