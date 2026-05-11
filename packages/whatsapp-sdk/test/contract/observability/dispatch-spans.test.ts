import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPhoneNumberId } from "../../../src/observability/redact.js";
import type { MessageEvent } from "../../../src/webhooks/events.js";
import { WebhookReceiver } from "../../../src/webhooks/receiver.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  provider.register();
});
afterAll(() => trace.disable());
beforeEach(() => exporter.reset());

const baseEvent: MessageEvent = {
  kind: "message",
  wabaId: "WABA-x",
  phoneNumberId: "PNID-y",
  timestamp: 1735689600000,
  id: "wamid.span-1",
  from: "521234567890",
  type: "text",
  body: { type: "text", text: { body: "hi" } },
};

describe("webhook dispatch spans", () => {
  it("emits one whatsapp.webhook.dispatch span per registered handler invocation", async () => {
    const receiver = new WebhookReceiver({ appSecret: "shh", verifyToken: "ok" });
    const handler = vi.fn();
    receiver.on("message", handler);
    await receiver._dispatchEvents([baseEvent]);

    const spans = exporter.getFinishedSpans();
    const dispatch = spans.find((s) => s.name === "whatsapp.webhook.dispatch");
    expect(dispatch).toBeDefined();
    expect(dispatch!.attributes["whatsapp.event.kind"]).toBe("message");
    expect(dispatch!.attributes["whatsapp.event.id"]).toBe("wamid.span-1");
    expect(dispatch!.attributes["whatsapp.waba_id"]).toBe(await hashPhoneNumberId("WABA-x"));
    expect(dispatch!.attributes["whatsapp.phone_number_id"]).toBe(
      await hashPhoneNumberId("PNID-y")
    );
  });

  it("records ERROR status when the handler throws", async () => {
    const receiver = new WebhookReceiver({ appSecret: "shh", verifyToken: "ok" });
    receiver.on("message", () => {
      throw new Error("handler boom");
    });
    await receiver._dispatchEvents([baseEvent]);

    const dispatch = exporter
      .getFinishedSpans()
      .find((s) => s.name === "whatsapp.webhook.dispatch");
    expect(dispatch).toBeDefined();
    expect(dispatch!.status.code).toBe(2); // ERROR
    const ex = dispatch!.events.find((e) => e.name === "exception");
    expect(ex).toBeDefined();
  });

  it("emits one span per handler when multiple are registered", async () => {
    const receiver = new WebhookReceiver({ appSecret: "shh", verifyToken: "ok" });
    receiver.on("message", () => {});
    receiver.on("message", () => Promise.resolve());
    await receiver._dispatchEvents([baseEvent]);

    const dispatched = exporter
      .getFinishedSpans()
      .filter((s) => s.name === "whatsapp.webhook.dispatch");
    expect(dispatched).toHaveLength(2);
  });
});
