import { hashPhoneNumberId } from "../observability/redact.js";
import { withSpan } from "../observability/tracing.js";
import { InMemoryStorage, type Storage } from "../storage/index.js";

import { WebhookDeduper } from "./dedupe.js";
import type {
  AccountAlertEvent,
  AccountReviewEvent,
  MessageEvent,
  PhoneNumberQualityUpdateEvent,
  StatusEvent,
  TemplateCategoryUpdateEvent,
  TemplateQualityUpdateEvent,
  TemplateStatusEvent,
  UnknownEvent,
  WhatsAppEvent,
} from "./events.js";
import { verifyHandshake } from "./handshake.js";
import { parseWebhookPayload } from "./parser.js";
import { verifySignature } from "./signature.js";

export interface WebhookReceiverOptions {
  appSecret: string;
  verifyToken: string;
  storage?: Storage;
  dedupeTtlMs?: number;
  /** Invoked once per handler error (in addition to the `error` event). */
  onError?: (err: unknown, event: WhatsAppEvent | undefined) => void;
}

export type EventKindMap = {
  message: MessageEvent;
  status: StatusEvent;
  template_status: TemplateStatusEvent;
  template_quality: TemplateQualityUpdateEvent;
  template_category: TemplateCategoryUpdateEvent;
  phone_number_quality: PhoneNumberQualityUpdateEvent;
  account_alert: AccountAlertEvent;
  account_review: AccountReviewEvent;
  unknown: UnknownEvent;
};

export type Handler<E> = (event: E) => void | Promise<void>;
export type ErrorHandler = (err: unknown, event: WhatsAppEvent | undefined) => void | Promise<void>;
type AnyHandler = Handler<WhatsAppEvent> | ErrorHandler;

export interface VerifyRequestInput {
  mode: string | null | undefined;
  verifyToken: string | null | undefined;
  challenge: string | null | undefined;
}

export type VerifyRequestResult = { status: 200; body: string } | { status: 403 };

export type HandlePayloadResult = { status: 200; dispatchPromise: Promise<void> } | { status: 401 };

/**
 * Framework-agnostic WhatsApp webhook receiver.
 *
 * Phase 8 wires this into Express via a sub-module adapter. Today,
 * consumers can use it directly:
 *
 *   const r = new WebhookReceiver({ appSecret, verifyToken });
 *   r.on("message", async (e) => { … });
 *   const { status, dispatchPromise } = r.handlePayload(rawBody, sig, body);
 *   res.status(status).end();
 *   // dispatchPromise resolves once handlers complete; do not await
 *   // it inside the HTTP handler (Meta's 30s ack rule).
 */
export class WebhookReceiver {
  readonly #appSecret: string;
  readonly #verifyToken: string;
  readonly #deduper: WebhookDeduper;
  readonly #onError: WebhookReceiverOptions["onError"];
  readonly #handlers = new Map<keyof EventKindMap | "error", Set<AnyHandler>>();

  constructor(options: WebhookReceiverOptions) {
    this.#appSecret = options.appSecret;
    this.#verifyToken = options.verifyToken;
    this.#deduper = new WebhookDeduper(
      options.storage ?? new InMemoryStorage(),
      options.dedupeTtlMs
    );
    this.#onError = options.onError;
  }

  public on<K extends keyof EventKindMap>(kind: K, handler: Handler<EventKindMap[K]>): this;
  public on(kind: "error", handler: ErrorHandler): this;
  public on(kind: keyof EventKindMap | "error", handler: AnyHandler): this {
    let set = this.#handlers.get(kind);
    if (set === undefined) {
      set = new Set();
      this.#handlers.set(kind, set);
    }
    set.add(handler);
    return this;
  }

  public off<K extends keyof EventKindMap>(kind: K, handler: Handler<EventKindMap[K]>): this;
  public off(kind: "error", handler: ErrorHandler): this;
  public off(kind: keyof EventKindMap | "error", handler: AnyHandler): this {
    this.#handlers.get(kind)?.delete(handler);
    return this;
  }

  public verify(
    rawBody: Buffer | Uint8Array | string,
    signatureHeader: string | null | undefined
  ): boolean {
    return verifySignature({ rawBody, signatureHeader, appSecret: this.#appSecret });
  }

  public handleVerifyRequest(input: VerifyRequestInput): VerifyRequestResult {
    const challenge = verifyHandshake({
      mode: input.mode,
      verifyToken: input.verifyToken,
      challenge: input.challenge,
      expectedToken: this.#verifyToken,
    });
    if (challenge === null) return { status: 403 };
    return { status: 200, body: challenge };
  }

  public handlePayload(
    rawBody: Buffer | Uint8Array | string,
    signatureHeader: string | null | undefined,
    parsedBody: unknown
  ): HandlePayloadResult {
    if (!this.verify(rawBody, signatureHeader)) {
      return { status: 401 };
    }
    const events = parseWebhookPayload(parsedBody);
    return { status: 200, dispatchPromise: this.#dispatch(events) };
  }

  /** @internal — used by mock-mode (Phase 6) to inject synthetic events. */
  public _dispatchEvents(events: ReadonlyArray<WhatsAppEvent>): Promise<void> {
    return this.#dispatch(events);
  }

  async #dispatch(events: ReadonlyArray<WhatsAppEvent>): Promise<void> {
    const tasks: Array<Promise<void>> = [];
    for (const event of events) {
      const dedupeKey = makeDedupeKey(event);
      if (dedupeKey !== undefined) {
        const fresh = await this.#deduper.markIfNew(dedupeKey);
        if (!fresh) continue;
      }
      const handlers = this.#handlers.get(event.kind);
      if (handlers) {
        for (const h of handlers) {
          tasks.push(this.#runHandler(h, event));
        }
      }
    }
    await Promise.allSettled(tasks);
  }

  async #runHandler(h: AnyHandler, event: WhatsAppEvent): Promise<void> {
    try {
      await withSpan(
        "whatsapp.webhook.dispatch",
        () => Promise.resolve((h as Handler<WhatsAppEvent>)(event)),
        spanAttributes(event)
      );
    } catch (err) {
      this.#onError?.(err, event);
      const errorHandlers = this.#handlers.get("error");
      if (errorHandlers) {
        for (const eh of errorHandlers) {
          try {
            await (eh as ErrorHandler)(err, event);
          } catch {
            // swallow secondary failures from the error handler itself
          }
        }
      }
    }
  }
}

function spanAttributes(event: WhatsAppEvent): Record<string, string> {
  const attrs: Record<string, string> = {
    "whatsapp.event.kind": event.kind,
    "whatsapp.waba_id": hashPhoneNumberId(event.wabaId),
  };
  if (event.phoneNumberId !== undefined) {
    attrs["whatsapp.phone_number_id"] = hashPhoneNumberId(event.phoneNumberId);
  }
  if (event.kind === "message" || event.kind === "status") {
    attrs["whatsapp.event.id"] = event.id;
  }
  return attrs;
}

function makeDedupeKey(event: WhatsAppEvent): string | undefined {
  switch (event.kind) {
    case "message":
      return `msg:${event.id}`;
    case "status":
      return `status:${event.id}:${event.status}`;
    default:
      return undefined;
  }
}
