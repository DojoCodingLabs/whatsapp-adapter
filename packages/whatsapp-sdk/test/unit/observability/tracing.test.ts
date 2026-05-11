import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { withSpan } from "../../../src/observability/tracing.js";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});

afterAll(() => {
  trace.disable();
});

afterEach(() => {
  exporter.reset();
});

describe("withSpan", () => {
  it("records a successful span and returns the result", async () => {
    const result = await withSpan("test.success", () => Promise.resolve(42), {
      "whatsapp.foo": "bar",
    });
    expect(result).toBe(42);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("test.success");
    expect(spans[0]!.attributes["whatsapp.foo"]).toBe("bar");
    expect(spans[0]!.status.code).not.toBe(2); // SpanStatusCode.ERROR === 2
  });

  it("records an exception and sets ERROR status", async () => {
    await expect(withSpan("test.fail", () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom"
    );
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(2); // ERROR
    const exceptionEvent = spans[0]!.events.find((e) => e.name === "exception");
    expect(exceptionEvent).toBeDefined();
  });

  it("records non-Error throws with ERROR status (no recordException)", async () => {
    const nonError = "not-an-error";
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    await expect(withSpan("test.fail.string", () => Promise.reject(nonError))).rejects.toBe(
      "not-an-error"
    );
    const spans = exporter.getFinishedSpans();
    expect(spans[0]!.status.code).toBe(2);
  });
});
