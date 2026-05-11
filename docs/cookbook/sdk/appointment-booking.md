# Appointment booking

Multi-turn flow that collects structured information across turns:
service → date → time → confirmation. Uses interactive lists for the
date/time picks (faster than free-text, more reliable than menus). The
shape generalises to lead qualification, order placement, and any
slot-collection task.

## Why this shape

- **Interactive lists / buttons** are the right primitive when the
  answer space is bounded. Free text is for when it isn't.
- **Slot ledger accumulates, not resets.** Every turn writes to the
  same conversation state record; you never re-ask for a slot you
  already have.
- **Confirmation step** before the booking is committed — cheap to
  cancel, expensive to revoke.
- **Out-of-window resumption.** If the customer drops off mid-flow and
  comes back hours later (still inside the 24h window), pick up where
  you left off; outside the window, send a utility template inviting
  them to resume.

## The flow

```
customer: "I want to book"           ← intent classifier returns "book"
bot:      [interactive list: services]
customer: taps "Tour: Cloud Forest"  ← slot.service set
bot:      [interactive list: next 7 days]
customer: taps "Tue, May 14"         ← slot.date set
bot:      [interactive list: time slots for that day]
customer: taps "10:00 AM"            ← slot.time set
bot:      [text confirmation: summary + button replies]
customer: taps "Confirm"             ← commit booking
bot:      "Booked ✓ — see you Tue at 10am."
```

## Code (the slot-machine, agent-shaped)

```ts
import "dotenv/config";
import {
  WhatsAppClient,
  WindowTracker,
  InMemoryStorage,
  type MessageEvent,
} from "@dojocoding/whatsapp";

const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const tracker = new WindowTracker({ phoneNumberId, storage: new InMemoryStorage() });
const client = new WhatsAppClient({
  phoneNumberId,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  windowTracker: tracker,
});

interface BookingState {
  intent: "book";
  service?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  status: "collecting" | "confirming" | "done";
}

// Replace with your real conversation store. Keys: (phoneNumberId, customerWaId).
const state = new Map<string, BookingState>();

export async function handleBookingTurn(e: MessageEvent) {
  const key = `${phoneNumberId}:${e.from}`;
  let s = state.get(key);

  // 1. New flow — set initial state.
  if (!s) {
    s = { intent: "book", status: "collecting" };
    state.set(key, s);
  }

  // 2. Decode the inbound. List replies are interactive_list_reply;
  //    button replies are interactive_button_reply; everything else
  //    is treated as free-text input.
  const choice = decodeChoice(e);

  // 3. Update slots based on what the user just sent.
  if (s.status === "collecting") {
    if (!s.service) {
      if (choice?.kind === "list" && choice.id.startsWith("service:")) s.service = choice.id;
      else return askService(e.from);
    } else if (!s.date) {
      if (choice?.kind === "list" && choice.id.startsWith("date:")) s.date = choice.id.slice(5);
      else return askDate(e.from, s);
    } else if (!s.time) {
      if (choice?.kind === "list" && choice.id.startsWith("time:")) s.time = choice.id.slice(5);
      else return askTime(e.from, s);
    } else {
      s.status = "confirming";
      return askConfirm(e.from, s);
    }
    // Re-ask the *next* missing slot in one place, no fallthrough.
    return handleBookingTurn(e);
  }

  if (s.status === "confirming") {
    if (choice?.kind === "button" && choice.id === "confirm") {
      await commitBooking(s);
      s.status = "done";
      await client.sendText({
        to: e.from,
        body: "Booked ✓ — see you on " + s.date + " at " + s.time,
      });
    } else if (choice?.kind === "button" && choice.id === "cancel") {
      state.delete(key);
      await client.sendText({
        to: e.from,
        body: "No problem, cancelled. Message me anytime to start over.",
      });
    } else {
      return askConfirm(e.from, s);
    }
  }
}

// ───────── prompt steps ─────────

function askService(to: string) {
  return client.sendInteractive({
    kind: "list",
    to,
    body: "Which service would you like to book?",
    button: "View services",
    sections: [
      {
        title: "Tours",
        rows: [
          { id: "service:cloud-forest", title: "Cloud Forest", description: "Half day" },
          { id: "service:rainforest", title: "Rainforest", description: "Full day" },
          { id: "service:zip-line", title: "Zip-line", description: "Half day" },
        ],
      },
    ],
  });
}

function askDate(to: string, _s: BookingState) {
  const days = nextSevenDays(); // [{ id: "date:2026-05-14", title: "Tue, May 14" }, ...]
  return client.sendInteractive({
    kind: "list",
    to,
    body: "Pick a date.",
    button: "View dates",
    sections: [{ title: "This week", rows: days }],
  });
}

function askTime(to: string, _s: BookingState) {
  const slots = availableTimes(_s.service!, _s.date!);
  return client.sendInteractive({
    kind: "list",
    to,
    body: "Pick a time.",
    button: "View times",
    sections: [{ title: "Available", rows: slots }],
  });
}

function askConfirm(to: string, s: BookingState) {
  return client.sendInteractive({
    kind: "button",
    to,
    body: `Confirm: ${s.service?.replace("service:", "")} on ${s.date} at ${s.time}?`,
    buttons: [
      { id: "confirm", title: "Confirm" },
      { id: "cancel", title: "Cancel" },
    ],
  });
}

// ───────── helpers ─────────

function decodeChoice(
  e: MessageEvent
):
  | { kind: "list"; id: string; title: string }
  | { kind: "button"; id: string; title: string }
  | undefined {
  if (e.type === "interactive_list_reply") {
    const reply = (e.body.interactive as { list_reply?: { id: string; title: string } } | undefined)
      ?.list_reply;
    return reply ? { kind: "list", ...reply } : undefined;
  }
  if (e.type === "interactive_button_reply") {
    const reply = (
      e.body.interactive as { button_reply?: { id: string; title: string } } | undefined
    )?.button_reply;
    return reply ? { kind: "button", ...reply } : undefined;
  }
  return undefined;
}

declare function nextSevenDays(): Array<{ id: string; title: string; description?: string }>;
declare function availableTimes(
  service: string,
  date: string
): Array<{ id: string; title: string }>;
declare function commitBooking(s: BookingState): Promise<void>;
```

## Things that bite

- **List sections cap at 1–10 sections, each 1–10 rows.** If you have
  more options, paginate with a "more" button row that re-prompts.
- **Row `id`s must be globally unique within the section** and survive
  in your state machine — prefix with the slot name (`service:`,
  `date:`, `time:`) so a stale tap from a previous turn doesn't get
  miscategorised.
- **The customer can type free text at any point** in an interactive
  flow. Decide: re-prompt with the same list, run the text through
  your intent classifier, or treat as escalation. Don't crash.
- **Date/time generation must be in the customer's timezone** if you
  know it (`event.body` from a contacts share, or your CRM). Don't
  send "Tue 10am" without a timezone disambiguation in the body text.
- **Resumption across the 24h window.** If `tracker.isWindowOpen(from)`
  returns false when you go to send the next prompt, the flow is
  paused. Either kick a utility template ("ready to continue your
  booking?") or wait for them to message first.
- **Confirmation step is non-negotiable.** Don't commit the booking
  on the third tap; the user might have miss-tapped. The
  confirmation tap is the consent.

## Where to go from here

- **Lead qualification** is the same shape: slots are
  (name, email, budget, timeline) instead of (service, date, time).
  The state machine transitions identically.
- **Adding a calendar provider:** call your provider's API inside
  `commitBooking`. If it fails after the customer tapped Confirm, send
  an apology + escalate (see
  [Two-way support with handoff](./two-way-support-with-handoff.md)).
- **Persistence:** swap the in-memory `Map` for Redis or Postgres
  keyed on `(phoneNumberId, customerWaId)`. The SDK doesn't manage
  conversation state — that's your job.
