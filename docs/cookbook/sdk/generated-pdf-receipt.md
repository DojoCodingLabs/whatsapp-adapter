# Cookbook — Generate a PDF, upload, and send as a document

The agent confirms a booking. The customer wants a receipt
they can keep. The cleanest path is: generate the PDF in the
process, upload it to Meta as media, and send it as a
WhatsApp document. The customer sees a native file attachment
with your filename — no link, no third-party host, no
expiration.

This recipe uses `client.uploadMedia` + `sendDocument`
(shipped in `sdk-v1.1.0`).

## When you need this

- Booking confirmations / appointment slips / order receipts.
- Quotes, contracts, and any document the customer will
  forward or print.
- Statements / invoices triggered by an event in your CRM.
- Generated brochures or itineraries the agent assembles on
  the fly per recipient.

If your PDF is **static** (same file for every recipient), you
don't need this loop. Upload once via the Graph API, store
the returned media id, and reuse it across sends — Meta media
ids are reusable within a WABA-phone pair.

## The flow

```
1. Agent decides to send a PDF
2. Generate PDF bytes in-process (pdfkit / Puppeteer / @react-pdf)
3. client.uploadMedia({ file: bytes, mimeType: "application/pdf" })
   └── POST /{phone-number-id}/media → { id }
4. client.sendDocument({ to, id, filename, caption })
   └── POST /{phone-number-id}/messages
5. Customer sees a native PDF attachment with `filename` shown
```

Steps 2–4 typically run inside the agent runtime or a queue
worker, NOT inside the webhook handler (PDF generation is
seconds; you want to ack the webhook first).

## Step 1: Generate the PDF

The SDK doesn't ship PDF generation — pick what fits your
shape. Three patterns:

### `pdfkit` (cheapest, fastest, ugly-by-default)

```ts
import PDFDocument from "pdfkit";

interface Booking {
  id: string;
  guestName: string;
  serviceName: string;
  startsAt: Date;
  price: number;
}

async function renderBookingPdf(booking: Booking): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);

    doc.fontSize(20).text("Booking confirmed", { align: "center" });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Guest:    ${booking.guestName}`);
    doc.text(`Service:  ${booking.serviceName}`);
    doc.text(`When:     ${booking.startsAt.toLocaleString("es-CR")}`);
    doc.text(`Total:    ₡${booking.price.toLocaleString("es-CR")}`);
    doc.moveDown();
    doc.fontSize(10).text(`Booking ID: ${booking.id}`);
    doc.end();
  });
}
```

Latency: <50 ms for a one-page PDF. Bundle impact: ~600 KB
(`pdfkit`). Right when you want speed and don't care about
visual polish.

### `@react-pdf/renderer` (designer-friendly, JSX)

```tsx
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica" },
  title: { fontSize: 24, marginBottom: 16 },
  row: { flexDirection: "row", marginVertical: 4 },
  label: { width: 100, color: "#666" },
  value: { fontWeight: "bold" },
});

const BookingReceipt = ({ booking }: { booking: Booking }) => (
  <Document>
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.title}>Booking confirmed</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Guest</Text>
        <Text style={styles.value}>{booking.guestName}</Text>
      </View>
      {/* … */}
    </Page>
  </Document>
);

async function renderBookingPdf(booking: Booking): Promise<Uint8Array> {
  const buf = await renderToBuffer(<BookingReceipt booking={booking} />);
  return new Uint8Array(buf);
}
```

Latency: ~100–300 ms. Bundle: ~2 MB. Right when the designer
wants control and you're already in a React stack.

### Puppeteer / Playwright (full HTML → PDF)

```ts
import puppeteer from "puppeteer";

async function renderBookingPdf(booking: Booking): Promise<Uint8Array> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(renderBookingHtml(booking), { waitUntil: "load" });
    const buf = await page.pdf({ format: "Letter", printBackground: true });
    return new Uint8Array(buf);
  } finally {
    await browser.close();
  }
}
```

Latency: 1–3 s per render (browser startup dominates). Bundle:
nontrivial. Use when the design needs CSS, web fonts, or
embedded charts. In production, pool the browser instance —
launching per-request is the slowest path.

## Step 2: Upload to Meta

```ts
import type { WhatsAppLikeClient } from "@dojocoding/whatsapp-sdk";

async function uploadBookingPdf(
  client: WhatsAppLikeClient,
  booking: Booking,
  bytes: Uint8Array
): Promise<string> {
  const { id } = await client.uploadMedia({
    file: bytes,
    mimeType: "application/pdf",
    filename: `booking-${booking.id}.pdf`,
  });
  return id;
}
```

The SDK enforces Meta's 100 MB document ceiling before the
HTTP call — payloads above that throw `CapabilityError` with
no wasted round-trip.

### Caching the media id

Meta media ids are **reusable across sends** within the same
WABA-phone pair. For documents you'll send to multiple
recipients (the same brochure, the same terms-of-service),
upload once and cache:

```ts
async function getOrUploadTermsId(client: WhatsAppLikeClient): Promise<string> {
  const cached = await mediaCache.get("terms-v3");
  if (cached) return cached;
  const bytes = await fs.readFile("./assets/terms-v3.pdf");
  const { id } = await client.uploadMedia({
    file: new Uint8Array(bytes),
    mimeType: "application/pdf",
    filename: "terms.pdf",
  });
  await mediaCache.set("terms-v3", id, { ttl: 30 * 24 * 60 * 60 }); // 30d
  return id;
}
```

Meta does NOT publish a TTL on uploaded media ids. Common
practice: cache for 30 days, then re-upload on a miss. If a
cached id 404s on send (rare, but happens), invalidate the
cache and retry.

## Step 3: Send as a document

```ts
async function sendBookingReceipt(
  client: WhatsAppLikeClient,
  to: string,
  booking: Booking
): Promise<void> {
  const bytes = await renderBookingPdf(booking);
  const mediaId = await uploadBookingPdf(client, booking, bytes);

  await client.sendDocument({
    to,
    id: mediaId,
    filename: `Booking-${booking.id}.pdf`,
    caption: `Confirmación de reserva — ${booking.guestName}`,
  });
}
```

The `filename` field controls what the recipient sees when
they save the attachment. Set it to something human and
unambiguous. The `caption` renders as a single line above the
file preview in the chat.

## Cross-tenant note

`uploadMedia` is scoped to the calling WABA-phone pair. In a
multi-tenant deployment (one orchestrator process serving
multiple `WhatsAppClient` instances), upload through the
tenant's own client — you can't share media ids across
tenants. The `WhatsAppLikeClient` interface keeps this
implicit: the tenant lookup happens before you hand the
client to this function.

## Window-gating

`sendDocument` is window-gated like every free-form send.
Generating a PDF for a recipient whose 24-hour window is
closed wastes the work — pre-flight with `client.isWindowOpen(to)`
when the cost of generation is high:

```ts
if (!(await client.isWindowOpen(to))) {
  // Either skip, queue for re-engagement template flow, or
  // send a window-exempt template that links to a hosted PDF.
  await queueForReengagement(booking);
  return;
}
await sendBookingReceipt(client, to, booking);
```

For booking confirmations triggered immediately after an
inbound message, the window is almost always open. For
batch-fired receipts (end-of-day digest), pre-flight is
worth it.

## Pairing with templates

If you need to send a PDF **outside** the 24-hour window,
templates are the escape hatch. Approved document-header
templates can carry a media id in the header component:

```ts
await client.sendTemplate({
  to,
  name: "booking_receipt",
  language: "es_MX",
  components: [
    {
      type: "header",
      parameters: [
        {
          type: "document",
          document: { id: mediaId, filename: `Booking-${booking.id}.pdf` },
        },
      ],
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: booking.guestName },
        { type: "text", text: booking.id },
      ],
    },
  ],
});
```

The template must be approved with a `DOCUMENT` header in
Business Manager. The body parameters substitute into the
approved copy.

## Through the MCP server

If the **agent** is deciding to send a PDF (rather than your
business code), use the
`whatsapp_upload_media_from_url` tool. The agent generates
the PDF, uploads it to a public URL (S3 presigned, your CDN,
etc.), and the MCP server fetches the URL and re-uploads to
Meta on the agent's behalf:

```ts
// On the agent side, via MCP:
await tools.whatsapp_upload_media_from_url({
  sourceUrl: "https://your-bucket.s3.amazonaws.com/receipts/abc.pdf?sig=…",
  mimeType: "application/pdf",
  filename: "receipt.pdf",
});
// → { mediaId, mimeType, bytes }

await tools.whatsapp_send_document({
  to,
  id: mediaId,
  filename: "Receipt.pdf",
  caption: "Your booking is confirmed.",
});
```

The MCP layer never receives the binary bytes — the URL
indirection means stdio framing isn't blown by large payloads.

## Gotchas

- **`filename` is recipient-visible.** Use a clean,
  customer-friendly name — `Booking-2026-05-17-Daniel.pdf`
  reads well; `tmp-rand-abc123.pdf` doesn't.
- **PDF/A vs PDF.** Some enterprise customers (legal, gov)
  require PDF/A for archival. `pdfkit` doesn't emit PDF/A
  natively; if you need it, use `@react-pdf/renderer` with
  the appropriate `pdfa` flag or post-process with
  `qpdf --linearize`.
- **Fonts in serverless.** Lambda/Cloudflare Workers don't
  ship Spanish-friendly fonts by default. Either bundle a
  font file (DejaVuSans is ~300 KB and covers most LATAM
  needs) or stick to Helvetica.
- **100 MB hard cap.** The SDK refuses uploads above 100 MB.
  For larger files, host them yourself and send a regular
  text link — but expect customers to ignore most links larger
  than ~10 MB on cellular.
- **Don't await PDF generation inside the webhook handler.**
  PDF rendering can take seconds; Meta's 30 s ack rule will
  fire long before you reach `client.uploadMedia`. Always
  defer to a queue worker or `waitUntil` boundary.

## See also

- [`./inbound-voice-transcribe.md`](./inbound-voice-transcribe.md)
  — the download-side counterpart (receive a voice note).
- [`./media-storage.md`](./media-storage.md) — for persisting
  generated PDFs to durable storage as part of your audit log.
- [`./appointment-booking.md`](./appointment-booking.md) —
  the booking flow this receipt typically closes.
- [`../../sdk/messages.md`](../../sdk/messages.md) §
  `sendDocument` — the send-method reference.
