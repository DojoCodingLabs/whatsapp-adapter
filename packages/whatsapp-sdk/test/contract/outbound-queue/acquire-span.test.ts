import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MockWhatsAppClient } from "../../../src/mock/client.js";
import { hashPhoneNumberId } from "../../../src/observability/redact.js";
import { withRateLimit } from "../../../src/queue/with-rate-limit.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => provider.register());
afterAll(() => trace.disable());
beforeEach(() => exporter.reset());

describe("withRateLimit acquire span", () => {
  it("names the per-phone bucket by hashed phone_number_id, never the raw id", async () => {
    const mock = new MockWhatsAppClient({ phoneNumberId: "PNID-span", wabaId: "WABA-span" });
    const wrapped = withRateLimit(mock);
    await wrapped.sendText({ to: "+5210000000001", body: "hi" });

    const span = exporter.getFinishedSpans().find((s) => s.name === "whatsapp.queue.acquire");
    expect(span).toBeDefined();
    expect(span!.attributes["whatsapp.queue.phone_number_id"]).toBe(
      await hashPhoneNumberId("PNID-span")
    );
    expect(Object.values(span!.attributes)).not.toContain("PNID-span");
    expect(Object.values(span!.attributes)).not.toContain("+5210000000001");
  });
});
