# Cookbook — Inbound voice notes → transcription → reply

In LATAM and many emerging markets, customers send voice notes
more than text. For a front-desk agent that means voice is the
**primary input shape**, not an edge case. This recipe shows
the canonical "voice in → transcript → LLM reply" loop using
`client.downloadMedia`.

## When you need this

- Your front-desk number receives voice notes and your agent
  needs to understand them.
- You're persisting transcripts to a CRM / ticket / conversation
  log keyed off the inbound `wamid`.
- You want to optionally **reply by voice** as well — the
  upload side (`client.uploadMedia` + `sendVoice`) closes the
  loop.

If your handler just forwards voice notes to a human inbox
without processing the audio, you don't need this — the human
plays the note in the inbox UI.

## The flow

```
1. Webhook → "audio" message event, type === "audio"
2. ack read (no typing yet — voice has its own "processing" UX)
3. client.downloadMedia(event.body.audio.id)
   ├── GET /{media-id}      → { url, mimeType, sha256, fileSize }
   └── fetchBytes()         → Uint8Array (5-min URL TTL)
4. Transcribe (Whisper / Groq / OpenAI / Azure)
5. (Optional) ack typing now that we're starting LLM work
6. Generate reply via your agent
7. Send text reply (or upload TTS audio → sendVoice)
```

The voice-note carve-out from
[`../hybrid/typing-while-thinking.md`](../hybrid/typing-while-thinking.md):
**don't fire the typing indicator on the read receipt for
voice notes**. The audio note already has its own "processing"
UI on the customer's side, and the typing state competes with
it. Fire typing only AFTER transcription completes and the LLM
starts thinking.

## Step 1: Receiver wiring

```ts
import {
  WhatsAppClient,
  WebhookReceiver,
  WindowTracker,
  InMemoryStorage,
} from "@dojocoding/whatsapp-sdk";

const tracker = new WindowTracker({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  storage: new InMemoryStorage(),
});
const client = new WhatsAppClient({
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  wabaId: process.env.WHATSAPP_WABA_ID!,
  token: process.env.WHATSAPP_TOKEN!,
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  windowTracker: tracker,
});
const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (event) => {
  if (event.type !== "audio") return;
  await tracker.notifyInbound(event.from, event.timestamp);

  // No typing indicator yet — voice has its own "processing" UI.
  void client.markAsRead({ messageId: event.id }).catch(() => {});

  await handleVoiceNote(event, client);
});
```

## Step 2: Download bytes from Meta

```ts
import type { MessageEvent } from "@dojocoding/whatsapp-sdk";

async function handleVoiceNote(event: MessageEvent, client: WhatsAppClient): Promise<void> {
  const audio = event.body["audio"] as { id?: string } | undefined;
  if (!audio?.id) return;

  // Two-step download. Metadata round-trip is cheap; the bytes
  // are gated behind fetchBytes() so consumers only pay the
  // bandwidth when they actually need the audio.
  const media = await client.downloadMedia(audio.id);

  // sha256 is stable across re-downloads of the same media.
  // Use it as a cache key for transcripts so a forwarded voice
  // note doesn't get re-transcribed.
  const cached = await transcriptCache.get(media.sha256);
  if (cached) return replyFromTranscript(event, client, cached);

  // Meta's pre-signed URL expires 5 minutes after issue. Fetch
  // bytes immediately — don't defer past that window.
  const bytes = await media.fetchBytes();

  const transcript = await transcribe(bytes, media.mimeType);
  await transcriptCache.set(media.sha256, transcript);

  return replyFromTranscript(event, client, transcript);
}
```

## Step 3: Transcribe

The SDK doesn't ship transcription — it's a per-vendor choice.
Three patterns:

### Groq Whisper (cheapest + fastest for short voice notes)

```ts
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! });

async function transcribe(bytes: Uint8Array, mimeType: string): Promise<string> {
  // Groq accepts a File-shaped argument; build one from the bytes.
  const file = new File([bytes], "audio.ogg", { type: mimeType });
  const result = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3-turbo",
    response_format: "text",
    language: "es", // hint helps for LATAM Spanish
  });
  return typeof result === "string" ? result : result.text;
}
```

Latency: ~0.5–1.5 s for a 30-second voice note. Cost: ~$0.00001
per minute at current pricing. For a front-desk doing thousands
of voice notes a day, this is rounding-error.

### OpenAI Whisper

Same shape, swap the SDK. Slightly higher latency, slightly
better punctuation. Use when you're already paying for OpenAI
elsewhere.

### Self-hosted (whisper.cpp / faster-whisper)

Run on a small GPU box. Right when you have privacy
requirements (Costa Rica's Ley 8968 for health/financial
verticals) or volume that makes API pricing meaningful (>1M
voice notes/month).

## Step 4: Reply

Now we're in normal agent territory — generate text, optionally
fire the typing indicator since we have LLM work ahead, then
send.

```ts
async function replyFromTranscript(
  event: MessageEvent,
  client: WhatsAppClient,
  transcript: string
): Promise<void> {
  // NOW the typing indicator earns its keep — the customer
  // already saw the voice-note "processed" UI, and the LLM is
  // about to take 2–5 s. Refresh the read receipt with typing
  // to bridge the gap.
  void client.markAsRead({ messageId: event.id, typing: true }).catch(() => {});

  const reply = await agent.respond({ from: event.from, transcript });

  await client.sendText({
    to: event.from,
    body: reply,
    replyTo: event.id,
  });
}
```

## (Optional) Step 5: Reply by voice

Some front desks are voice-first end-to-end — the customer sent
a voice note, the bot replies in voice. Use a TTS provider
(ElevenLabs, OpenAI, Azure, Google), upload the generated
audio via `client.uploadMedia`, send via `sendVoice`:

```ts
async function replyWithVoice(
  event: MessageEvent,
  client: WhatsAppClient,
  text: string
): Promise<void> {
  const ttsBytes = await synthesizeVoice(text); // Uint8Array of OGG/Opus
  const { id } = await client.uploadMedia({
    file: ttsBytes,
    mimeType: "audio/ogg",
    filename: "reply.ogg",
  });
  await client.sendVoice({ to: event.from, id });
}
```

`sendVoice` sets `voice: true` on the audio payload, which
triggers WhatsApp's "played" receipt and the native
auto-download UX on the recipient's phone.

Format note: WhatsApp expects voice notes in **OGG with Opus
codec** for best compatibility. Most TTS providers can output
this directly; if yours doesn't, transcode with `ffmpeg`
(`-c:a libopus`) before upload.

## With the agent-bridge primitive

If you're using `createAgentBridge`, the read-receipt + window-
notify steps are handled for you. You only need to opt out of
the auto-typing for audio (since the bridge's default fires
typing on every inbound), then handle the voice path in your
consumer:

```ts
import { createAgentBridge, InMemoryAgentInbox } from "@dojocoding/whatsapp-sdk";

const inbox = new InMemoryAgentInbox();

createAgentBridge({
  receiver,
  client,
  inbox,
  windowTracker: tracker,
  autoTyping: false, // we handle typing ourselves so voice can skip it
});

// In your agent runner:
async function runAgentLoop() {
  for (const task of inbox.tasks) {
    if (task.type === "audio") {
      // Voice path — no typing on the auto-ack
      await handleVoicePath(task, client);
    } else {
      // Text path — fire typing now since we have LLM work
      void client.markAsRead({ messageId: task.wamid, typing: true }).catch(() => {});
      await handleTextPath(task, client);
    }
  }
}
```

For richer behaviour (per-tenant transcript caching, per-locale
language hinting, mixed text+voice replies), keep the bridge
and customise via `transform` to enrich the `AgentTask` with
the bytes already downloaded.

## Gotchas

- **5-minute URL TTL.** `media.fetchBytes()` re-injects the
  bearer token, but if you stash `media.url` and try to fetch
  it 10 minutes later the CDN answers 403 and the SDK throws
  `MediaExpiredError`. Either fetch immediately or cache the
  bytes (not the URL); on `MediaExpiredError`, call
  `client.downloadMedia(id)` again for a fresh URL.
- **Language detection.** Whisper auto-detects, but for LATAM
  Spanish a `language: "es"` hint cuts errors meaningfully.
  For multi-tenant deployments, key the hint off the WABA's
  primary market.
- **Disfluencies.** Customers say "ehhhh… o sea…" and "este…"
  a lot in voice notes. Strip these in a post-processing step
  before handing to the LLM, or your prompt budget bloats.
- **The `voice: true` flag in inbound.** Meta sends
  `body.audio.voice: true` for voice notes (vs `false` for
  music/file uploads). Both still trip the `audio` type — gate
  on `voice === true` only if you specifically want to ignore
  music files.
- **Don't transcribe before the read receipt.** Transcription
  takes 0.5–2 s; on slow days it can take 5+. The customer
  must see the two blue ticks first or the whole flow feels
  broken. The order in step 1 above is right: ack first,
  then download/transcribe.

## See also

- [`../hybrid/typing-while-thinking.md`](../hybrid/typing-while-thinking.md)
  — why the voice path skips the typing indicator on the first
  ack.
- [`./media-storage.md`](./media-storage.md) — for persisting
  voice notes to durable storage (S3 / R2 / Supabase) as part
  of your conversation log.
- [`../../sdk/agent-bridge.md`](../../sdk/agent-bridge.md) —
  the primitive that auto-acks for you.
- [`./generated-pdf-receipt.md`](./generated-pdf-receipt.md) —
  the upload-side counterpart (send a generated file).
