# Cookbook — Media URL caching

Meta's media URLs from inbound webhook events expire in
~5 minutes. By the time your handler dispatches, retries, or
gets resumed by `waitUntil`, the URL might already be dead.
This recipe shows the canonical re-host pattern: download
once, store in your own bucket, serve from there.

The SDK doesn't ship this primitive. Storage shape varies too
much (S3 vs Supabase Storage vs R2 vs MinIO; per-recipient
prefixing; CDN integration; retention policy) to prescribe one
adapter. The pattern below is the template; adapt to your
backend.

## When you need this

- Your handler reads `event.body.image.id` / `event.body.video.id`
  and needs to download the media for processing (OCR, content
  moderation, vector embedding, etc.).
- Your agent surface re-serves the media URL to the customer
  in a follow-up (e.g. "we got your receipt, here it is →" via
  template).
- You're persisting attachments to a CRM / ticket / chat-log
  system that needs durable URLs.

If your handler just acknowledges receipt and doesn't touch
the media, you don't need this — Meta's URL is fine for the
window it lives in.

## The flow

```
Inbound webhook       ┌─────────────────────────┐
   ▼                  │  1. Resolve media URL    │
event.body.image      │     via Meta Graph API    │
                      ├──────────────┬────────────┤
                      │  2. Download │ time-bound │
                      ├──────────────┴────────────┤
                      │  3. Upload to your bucket │
                      ├───────────────────────────┤
                      │  4. Record durable URL +  │
                      │     SHA-256 in your DB    │
                      └───────────────────────────┘
                                 ▼
                       Use durable URL forever
```

Steps 1-3 happen inside the webhook handler (or, on
serverless, inside `waitUntil(...)`). Step 4 is your
persistence layer.

## Step 1: Resolve the media URL

Meta's webhook event carries a `media_id`. To get the actual
download URL, hit Meta's Graph API:

```ts
// lib/media.ts
import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";

interface MediaInfo {
  url: string;
  mimeType: string;
  sha256: string;
  fileSize: number;
}

export async function resolveMetaMediaUrl(
  client: WhatsAppClient,
  mediaId: string
): Promise<MediaInfo> {
  // Direct Graph API call via the SDK's request helper.
  // The SDK exposes `client.request` for cases the typed
  // surface doesn't cover.
  const result = await client.request<{
    url: string;
    mime_type: string;
    sha256: string;
    file_size: number;
  }>("GET", `/${mediaId}`);
  return {
    url: result.url,
    mimeType: result.mime_type,
    sha256: result.sha256,
    fileSize: result.file_size,
  };
}
```

The `url` Meta returns is a short-lived (~5 min) signed URL.
Don't persist it — only use it for the immediate download.

## Step 2: Download with the bearer

Meta requires the `Authorization: Bearer <token>` on the
download too — it's not a public URL. The SDK doesn't expose
its bearer-resolver as a public API directly; the cleanest
pattern is to call the SDK's `client.request` with `path =
'/' + mediaId` (returns the URL) then fetch the URL with your
own auth header:

```ts
// lib/media.ts (continued)
import { Readable } from "node:stream";

export async function downloadMetaMedia(
  client: WhatsAppClient,
  info: MediaInfo,
  token: string
): Promise<Buffer> {
  const res = await fetch(info.url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`media download failed: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}
```

Note: this function needs the bearer token explicitly. Either
pass it from the same env as the SDK (`process.env.WHATSAPP_ACCESS_TOKEN`)
or expose a helper from your boot code that resolves the
current token (matches the SDK's `TokenProvider` semantics).

## Step 3: Upload to your bucket

Pick your backend. Examples for the three common ones:

### S3 / R2 / DigitalOcean Spaces (S3-compatible)

```ts
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.S3_REGION!,
  // R2: { endpoint, credentials, region: "auto" }
});

export async function uploadToS3(buf: Buffer, info: MediaInfo, recipient: string): Promise<string> {
  const key = `whatsapp-media/${recipient}/${info.sha256}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: buf,
      ContentType: info.mimeType,
      // For S3 with a CloudFront CDN in front, set this; for
      // direct-from-S3 access, you typically set the bucket
      // policy public-read and skip ACLs.
    })
  );
  return `https://${process.env.S3_BUCKET!}.s3.amazonaws.com/${key}`;
}
```

### Supabase Storage

```ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function uploadToSupabase(
  buf: Buffer,
  info: MediaInfo,
  recipient: string
): Promise<string> {
  const path = `${recipient}/${info.sha256}`;
  const { error } = await supabase.storage.from("whatsapp-media").upload(path, buf, {
    contentType: info.mimeType,
    upsert: true,
  });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
  return publicUrl;
}
```

### Cloudflare R2 via Workers binding (Workers runtime only)

```ts
declare const MEDIA_BUCKET: R2Bucket; // wrangler.toml binding

export async function uploadToR2(buf: Buffer, info: MediaInfo, recipient: string): Promise<string> {
  const key = `${recipient}/${info.sha256}`;
  await MEDIA_BUCKET.put(key, buf, {
    httpMetadata: { contentType: info.mimeType },
  });
  return `${process.env.R2_PUBLIC_URL_BASE}/${key}`;
}
```

## Step 4: Record in your DB

```ts
// db.media.create({ media_id, sha256, mime_type, durable_url, recorded_at })
```

Index on `media_id` so you can short-circuit: if Meta sends
the same `media_id` again (rare but possible on webhook
retries), skip the re-download.

## Full handler

```ts
// app/api/webhooks/whatsapp/route.ts
import { WebhookReceiver } from "@dojocoding/whatsapp-sdk";
import { createWhatsAppHandler } from "@dojocoding/whatsapp-sdk/web";
import { waitUntil } from "@vercel/functions";

import { client } from "@/lib/whatsapp";
import { downloadMetaMedia, resolveMetaMediaUrl, uploadToS3 } from "@/lib/media";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const receiver = new WebhookReceiver({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
});

receiver.on("message", async (e) => {
  // Only handle media-bearing inbound types.
  const mediaTypes = ["image", "video", "audio", "document", "sticker"] as const;
  if (!mediaTypes.includes(e.type as (typeof mediaTypes)[number])) return;

  const media = (e.body as Record<string, { id?: string } | undefined>)[e.type];
  const mediaId = media?.id;
  if (typeof mediaId !== "string") return;

  // Idempotency — bail if we've already cached this media.
  const cached = await db.media.findUnique({ where: { mediaId } });
  if (cached !== null) return;

  const info = await resolveMetaMediaUrl(client, mediaId);
  const buf = await downloadMetaMedia(client, info, process.env.WHATSAPP_ACCESS_TOKEN!);
  const durableUrl = await uploadToS3(buf, info, e.from);

  await db.media.create({
    data: {
      mediaId,
      sha256: info.sha256,
      mimeType: info.mimeType,
      fileSize: info.fileSize,
      recipient: e.from,
      durableUrl,
      recordedAt: new Date(),
    },
  });
});

const handler = createWhatsAppHandler(receiver, { waitUntil });
export const GET = handler;
export const POST = handler;
```

## Caveats

- **Storage cost.** Media files are big. Use lifecycle rules
  on your bucket — most consumer-facing flows need media for
  ~90 days for support / dispute resolution, then it's fine
  to delete. Set up object-expiration policies.
- **Privacy.** Customer-shared media is PII. Lock down public
  access; sign URLs with short TTLs for re-serving; redact /
  delete on right-to-be-forgotten requests.
- **Virus scanning.** Don't skip this. Run uploads through
  ClamAV (or your provider's scanner — Cloudflare Workers has
  one built in, AWS has GuardDuty Malware Protection) before
  exposing the durable URL to any human or downstream system.
- **`waitUntil` budget on Vercel.** A 4 MB image upload to S3
  takes ~1-3s on Vercel Node. Well within the function
  budget (60-300s) but worth monitoring as part of your
  webhook-ack latency story.
- **Re-using the durable URL in outbound sends.** Meta's
  `sendImage({ link })` requires a public HTTPS URL. Your
  bucket needs public-read access OR you need to mint a
  signed URL with enough TTL for Meta to fetch it (~30s
  minimum to be safe).

## See also

- [`docs/sdk/messages.md`](../../sdk/messages.md) — outbound
  media-send builders.
- [`docs/sdk/webhooks.md`](../../sdk/webhooks.md) §
  "Inbound message events" — the parsed event shapes.
