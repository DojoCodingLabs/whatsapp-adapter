/**
 * Web-standard (Fetch-API) adapter for `@dojocoding/whatsapp-sdk`.
 *
 * Returns a function with shape `(req: Request) => Promise<Response>` —
 * mountable as a Cloudflare Workers `fetch` handler, a Hono / Next.js
 * App Router route handler, a Bun `Bun.serve` handler, or anywhere
 * else that speaks the Fetch API.
 *
 * The Express adapter (`@dojocoding/whatsapp-sdk/express`) is a thin shim
 * over this same core; see `docs/web.md` for runtime examples.
 *
 * Behaviour:
 *   - GET → verify-token handshake via `receiver.handleVerifyRequest`.
 *           200 text/plain with the challenge body on success, 403 on
 *           mismatch.
 *   - POST → raw bytes via `req.arrayBuffer()` (read exactly once),
 *           passed verbatim to `receiver.handlePayload`. Acks 200
 *           BEFORE awaiting handlers (Meta's 30 s rule), then runs
 *           handlers asynchronously. 401 on a bad signature; 400 on
 *           a correctly signed body that is not JSON (including an
 *           empty body).
 *   - Other verbs → 405 Method Not Allowed.
 */

import type { WhatsAppEvent } from "../../webhooks/events.js";
import { parseWebhookPayload } from "../../webhooks/parser.js";
import type { WebhookReceiver } from "../../webhooks/receiver.js";
import { verifySignature } from "../../webhooks/signature.js";

const SIGNATURE_HEADER = "x-hub-signature-256";

/** Marker for a body that is not valid JSON (distinct from a JSON `null`). */
const INVALID_JSON: unique symbol = Symbol("invalid-json");

/** Read the body bytes exactly once and decode JSON from a copy of them. */
async function readBody(req: Request): Promise<{ rawBody: Uint8Array; parsed: unknown }> {
  const rawBody = new Uint8Array(await req.arrayBuffer());
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8").decode(rawBody));
  } catch {
    parsed = INVALID_JSON;
  }
  return { rawBody, parsed };
}

export interface VerifyAndParseWebhookOptions {
  /** Your Meta app secret (HMAC key for `X-Hub-Signature-256`). */
  appSecret: string;
}

export type VerifyAndParseWebhookResult =
  | { status: 401 }
  | { status: 400 }
  | {
      status: 200;
      /** Parsed events, in payload order. Not deduplicated. */
      events: ReadonlyArray<WhatsAppEvent>;
      /** The exact bytes that were verified. */
      rawBody: Uint8Array;
    };

/**
 * Verify and parse one Meta webhook POST for frameworks that own
 * routing and the response (e.g. an eve `defineChannel` POST route,
 * a Next.js route handler that also does other work).
 *
 * - Reads the raw body bytes exactly once.
 * - Verifies `X-Hub-Signature-256` with the timing-safe
 *   `verifySignature` → `{ status: 401 }` on any failure. The
 *   signature is checked BEFORE the body is parsed.
 * - A correctly signed body that is not JSON → `{ status: 400 }`.
 * - Otherwise `{ status: 200, events, rawBody }` via
 *   `parseWebhookPayload`.
 *
 * It does not deduplicate, dispatch or respond: the caller returns
 * the status to Meta promptly (200 within 30 s) and processes
 * `events` after the response (e.g. with `waitUntil`), deduping by
 * wamid. Use `createWhatsAppHandler` instead when a
 * `WebhookReceiver` should own dispatch and dedupe.
 */
export async function verifyAndParseWebhook(
  req: Request,
  options: VerifyAndParseWebhookOptions
): Promise<VerifyAndParseWebhookResult> {
  const { rawBody, parsed } = await readBody(req);
  const ok = await verifySignature({
    rawBody,
    signatureHeader: req.headers.get(SIGNATURE_HEADER),
    appSecret: options.appSecret,
  });
  if (!ok) return { status: 401 };
  if (parsed === INVALID_JSON) return { status: 400 };
  return { status: 200, events: parseWebhookPayload(parsed), rawBody };
}

export interface CreateWhatsAppHandlerOptions {
  /**
   * Invoked when a handler thrown error escapes the dispatch promise.
   * Defaults to `console.error`.
   */
  onUnhandledHandlerError?: (err: unknown) => void;
  /**
   * Runtime-supplied lifecycle extension. Supply this on serverless
   * runtimes that kill the function invocation after the `Response`
   * is returned (Vercel Functions, Cloudflare Workers) — without it,
   * the async dispatch promise is silently dropped along with any
   * handler side-effects.
   *
   * The adapter passes the dispatch promise (already chained with
   * `.catch(onUnhandledHandlerError)` so it always resolves) to this
   * callback. The runtime then awaits it within its function-budget
   * lifecycle.
   *
   * Typical wiring:
   *
   *   // Vercel Functions (Node runtime):
   *   import { waitUntil } from "@vercel/functions";
   *   createWhatsAppHandler(receiver, { waitUntil });
   *
   *   // Cloudflare Workers:
   *   export default {
   *     fetch(req: Request, env: Env, ctx: ExecutionContext) {
   *       const handler = createWhatsAppHandler(receiver, {
   *         waitUntil: ctx.waitUntil.bind(ctx),
   *       });
   *       return handler(req);
   *     },
   *   };
   *
   * When omitted (long-lived Node / Bun / Deno servers), the adapter
   * keeps its fire-and-forget behaviour — the dispatch promise lives
   * on the event loop after the response.
   *
   * Not invoked on the verify-handshake (GET) path; there is no async
   * dispatch to extend.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type WhatsAppHandler = (req: Request) => Promise<Response>;

/**
 * Build a Fetch-API handler wiring Meta's webhook contract to a
 * framework-agnostic {@link WebhookReceiver}.
 */
export function createWhatsAppHandler(
  receiver: WebhookReceiver,
  options: CreateWhatsAppHandlerOptions = {}
): WhatsAppHandler {
  const onUnhandledHandlerError =
    options.onUnhandledHandlerError ??
    ((err: unknown): void => {
      console.error("[whatsapp/web] unhandled handler error:", err);
    });

  return async (req: Request): Promise<Response> => {
    const method = req.method.toUpperCase();

    if (method === "GET") {
      const url = new URL(req.url);
      const mode = url.searchParams.get("hub.mode") ?? undefined;
      const verifyToken = url.searchParams.get("hub.verify_token") ?? undefined;
      const challenge = url.searchParams.get("hub.challenge") ?? undefined;
      const result = receiver.handleVerifyRequest({ mode, verifyToken, challenge });
      if (result.status === 200) {
        return new Response(result.body, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(null, { status: 403 });
    }

    if (method === "POST") {
      // Read raw bytes ONCE. These exact bytes are fed to the HMAC
      // verifier; JSON parsing happens on a separate decode.
      const { rawBody, parsed } = await readBody(req);
      const sigHeader = req.headers.get(SIGNATURE_HEADER);
      if (parsed === INVALID_JSON) {
        // Signature first (never reveal parse results to an
        // unauthenticated caller), then 400 for a signed non-JSON body.
        const ok = await receiver.verify(rawBody, sigHeader);
        return new Response(null, { status: ok ? 400 : 401 });
      }
      const result = await receiver.handlePayload(rawBody, sigHeader, parsed);
      if (result.status === 200) {
        // Run handlers async — the Response is returned below; a slow
        // handler does not delay Meta's 30 s ack. Chain `.catch` first
        // so the promise we hand to `waitUntil` ALWAYS resolves; an
        // unhandled rejection passed to `waitUntil` would surface as a
        // runtime warning on Vercel / Workers.
        const settled = result.dispatchPromise.catch(onUnhandledHandlerError);
        if (options.waitUntil !== undefined) {
          options.waitUntil(settled);
        }
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 401 });
    }

    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  };
}
