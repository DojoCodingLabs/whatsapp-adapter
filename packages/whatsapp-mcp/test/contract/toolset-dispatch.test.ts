import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { beforeEach, describe, expect, it } from "vitest";

import { createWhatsAppToolset, type WhatsAppToolset } from "../../src/index.js";

/**
 * Contract test for the embedded toolset's `dispatch` path.
 *
 * Asserts (a) happy paths return the canonical send-result shape,
 * (b) typed SDK errors map to `isError + structuredContent.error`
 * with the matching recovery hint, (c) schema-validation failures
 * map to `code: "invalid_args"`, (d) unknown tool names map to
 * `code: "unknown_tool"`, and (e) `dispatch` never throws on
 * model-recoverable errors (it returns the response).
 */

function makeToolset(): WhatsAppToolset {
  const client = new MockWhatsAppClient({
    phoneNumberId: "PNID",
    wabaId: "WABA",
  });
  return createWhatsAppToolset({ client, wabaPhoneNumberId: "PNID" });
}

describe("WhatsAppToolset.dispatch — happy paths", () => {
  let toolset: WhatsAppToolset;
  beforeEach(() => {
    toolset = makeToolset();
  });

  it("whatsapp_send_text round-trips with structuredContent.messageId", async () => {
    const result = await toolset.dispatch("whatsapp_send_text", {
      to: "+5210000000001",
      body: "Hello from the embedded toolset",
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeDefined();
    const sc = result.structuredContent as { messageId: string; recipientPhone: string };
    expect(sc.messageId).toMatch(/^wamid\.mock-\d+$/);
    expect(sc.recipientPhone).toBe("+5210000000001");
  });

  it("whatsapp_send_template round-trips", async () => {
    const result = await toolset.dispatch("whatsapp_send_template", {
      to: "+5210000000001",
      name: "hello_world",
      language: "en_US",
    });
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as { messageId: string }).messageId).toMatch(
      /^wamid\.mock-\d+$/
    );
  });

  it("whatsapp_send_reaction round-trips", async () => {
    const result = await toolset.dispatch("whatsapp_send_reaction", {
      to: "+5210000000001",
      messageId: "wamid.from-inbound",
      emoji: "🎉",
    });
    expect(result.isError).not.toBe(true);
  });

  it("whatsapp_list_templates returns the mock's empty list", async () => {
    const result = await toolset.dispatch("whatsapp_list_templates", {});
    expect(result.isError).not.toBe(true);
    const sc = result.structuredContent as { data: Array<unknown> };
    expect(Array.isArray(sc.data)).toBe(true);
  });
});

describe("WhatsAppToolset.dispatch — error paths", () => {
  it("unknown tool → code: 'unknown_tool'", async () => {
    const toolset = makeToolset();
    const result = await toolset.dispatch("whatsapp_nonexistent", {});
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
      "unknown_tool"
    );
    expect(result.content[0]?.text).toMatch(/Re-read.*tools\/list/i);
  });

  it("invalid args (wrong type) → code: 'invalid_args'", async () => {
    const toolset = makeToolset();
    const result = await toolset.dispatch("whatsapp_send_text", {
      to: 123, // should be string
      body: "x",
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
      "invalid_args"
    );
  });

  it("invalid args (missing required field) → code: 'invalid_args'", async () => {
    const toolset = makeToolset();
    const result = await toolset.dispatch("whatsapp_send_text", {
      to: "+5210000000001",
      // body missing
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: { code: string } }).error.code).toBe(
      "invalid_args"
    );
  });

  it("WindowClosedError → code: 'WINDOW_CLOSED' with the canonical recovery hint", async () => {
    // Set up a window tracker that returns false to force the
    // mock client to throw WindowClosedError on a free-form send.
    const { InMemoryStorage, WindowTracker } = await import("@dojocoding/whatsapp-sdk");
    const tracker = new WindowTracker({
      storage: new InMemoryStorage(),
      phoneNumberId: "PNID",
    });
    const client = new MockWhatsAppClient({
      phoneNumberId: "PNID",
      wabaId: "WABA",
      windowTracker: tracker,
    });
    const toolset = createWhatsAppToolset({
      client,
      wabaPhoneNumberId: "PNID",
      windowTracker: tracker,
    });

    const result = await toolset.dispatch("whatsapp_send_text", {
      to: "+5210000000001",
      body: "this should fail because window is closed",
    });
    expect(result.isError).toBe(true);
    const err = (result.structuredContent as { error: { code: string; message: string } }).error;
    expect(err.code).toBe("WINDOW_CLOSED");
    expect(result.content[0]?.text).toMatch(/24-hour customer-service window/i);
    expect(result.content[0]?.text).toMatch(/whatsapp_send_template/);
  });

  it("dispatch returns the error response — does NOT throw", async () => {
    const toolset = makeToolset();
    // Pass a fundamentally broken args shape; should still resolve.
    await expect(toolset.dispatch("whatsapp_send_text", null)).resolves.toBeDefined();
    await expect(toolset.dispatch("nonexistent", {})).resolves.toBeDefined();
  });
});

describe("WhatsAppToolset — surface invariants", () => {
  it("does NOT contain credential fields in any inputSchema", () => {
    const toolset = makeToolset();
    const FORBIDDEN = ["accessToken", "phoneNumberId", "appSecret", "businessAccountId"];
    for (const def of toolset.tools) {
      const keys = Object.keys(def.inputSchema);
      for (const f of FORBIDDEN) {
        expect(
          keys,
          `tool ${def.name} must not declare credential field ${f} in inputSchema`
        ).not.toContain(f);
      }
    }
  });

  it("tools, resources, prompts arrays are stable across calls", () => {
    const a = makeToolset();
    const b = makeToolset();
    expect(a.tools.map((t) => t.name)).toEqual(b.tools.map((t) => t.name));
    expect(a.resources.map((r) => r.name)).toEqual(b.resources.map((r) => r.name));
    expect(a.prompts.map((p) => p.name)).toEqual(b.prompts.map((p) => p.name));
  });
});

interface TemplatesBody {
  data: unknown[];
  cachedAt: string;
  cacheTtlMs: number;
}

interface WindowBody {
  phone: string;
  isOpen: boolean;
  notice?: string;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    recoveryHint: string;
  };
}

describe("WhatsAppToolset.readResource", () => {
  it("reads whatsapp://templates", async () => {
    const toolset = makeToolset();
    const r = await toolset.readResource("whatsapp://templates");
    expect(r.contents).toHaveLength(1);
    const body = JSON.parse((r.contents[0] as { text: string }).text) as TemplatesBody;
    expect(body.data).toEqual([]); // mock has no templates
    expect(body.cachedAt).toBeDefined();
  });

  it("reads whatsapp://window/<phone>", async () => {
    const toolset = makeToolset();
    const r = await toolset.readResource("whatsapp://window/+5210000000001");
    expect(r.contents).toHaveLength(1);
    const body = JSON.parse((r.contents[0] as { text: string }).text) as WindowBody;
    expect(body.phone).toBe("+5210000000001");
    expect(body.isOpen).toBe(false);
    expect(body.notice).toMatch(/No WindowTracker/);
  });

  it("returns an unknown-resource error body on a bad URI", async () => {
    const toolset = makeToolset();
    const r = await toolset.readResource("whatsapp://bogus");
    const body = JSON.parse((r.contents[0] as { text: string }).text) as ErrorBody;
    expect(body.error.code).toBe("unknown_resource");
  });
});

describe("WhatsAppToolset.renderPrompt", () => {
  it("renders wa-template-send with no args", async () => {
    const toolset = makeToolset();
    const r = await toolset.renderPrompt("wa-template-send");
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.content.text).toMatch(/whatsapp:\/\/templates/);
  });

  it("renders wa-template-send with both args", async () => {
    const toolset = makeToolset();
    const r = await toolset.renderPrompt("wa-template-send", {
      templateName: "hello_world",
      recipientPhone: "+5210000000001",
    });
    const text = r.messages[0]?.content.text ?? "";
    expect(text).toMatch(/hello_world/);
    expect(text).toMatch(/\+5210000000001/);
  });

  it("returns a guidance message for an unknown prompt name", async () => {
    const toolset = makeToolset();
    const r = await toolset.renderPrompt("nonexistent");
    expect(r.messages[0]?.content.text).toMatch(/does not match any/);
  });
});
