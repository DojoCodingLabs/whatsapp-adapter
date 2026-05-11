import { type Attributes, type Span, SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";

const TRACER_NAME = "@dojocoding/whatsapp-sdk";
const TRACER_VERSION = "0.0.0";

/**
 * Convenience accessor for the SDK's tracer. When no provider is
 * registered (default), the OTel API returns a no-op tracer and the
 * spans we emit are silent.
 */
export function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

/**
 * Run `fn` inside an active OTel span. Applies `attributes` on start,
 * records exceptions, sets the span's status to ERROR on rejection,
 * and ends the span exactly once. Returns whatever `fn` resolves with.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Attributes
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, async (span: Span): Promise<T> => {
    if (attributes !== undefined) {
      span.setAttributes(attributes);
    }
    try {
      const result = await fn();
      span.end();
      return result;
    } catch (err) {
      if (err instanceof Error) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      } else {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      }
      span.end();
      throw err;
    }
  });
}
