import { MockWhatsAppClient } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WhatsAppMcpServer } from "../../src/index.js";
import { assessSourceUrl } from "../../src/tools/upload-media-from-url.js";

const PHONE_NUMBER_ID = "111122223333";
const WABA_ID = "999988887777";

let sdk: MockWhatsAppClient;
let server: WhatsAppMcpServer;
let client: Client;

interface ToolResult {
  isError?: boolean | undefined;
  content?: ReadonlyArray<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}

async function setup(): Promise<void> {
  sdk = new MockWhatsAppClient({ phoneNumberId: PHONE_NUMBER_ID, wabaId: WABA_ID });
  server = new WhatsAppMcpServer({ client: sdk, wabaPhoneNumberId: PHONE_NUMBER_ID });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "media-ack-tools-test", version: "0.0.0" }, {});
  await Promise.all([server.connect(a), client.connect(b)]);
}

async function teardown(): Promise<void> {
  await client.close();
  await server.close();
  vi.unstubAllGlobals();
}

beforeEach(setup);
afterEach(teardown);

function errorCode(r: ToolResult): string | undefined {
  const err = r.structuredContent?.["error"] as { code?: string } | undefined;
  return err?.code;
}

describe("whatsapp_mark_as_read", () => {
  it("acks the wamid on the SDK and reports typing=false by default", async () => {
    const r = (await client.callTool({
      name: "whatsapp_mark_as_read",
      arguments: { messageId: "wamid.inbound-1" },
    })) as ToolResult;
    expect(r.isError, JSON.stringify(r)).toBeFalsy();
    expect(r.structuredContent).toEqual({
      success: true,
      messageId: "wamid.inbound-1",
      typing: false,
    });
    expect(sdk.markReads).toHaveLength(1);
    expect(sdk.markReads[0]).toMatchObject({ messageId: "wamid.inbound-1", typing: false });
    expect(typeof sdk.markReads[0]?.at).toBe("number");
  });

  it("forwards typing=true and says so in the text content", async () => {
    const r = (await client.callTool({
      name: "whatsapp_mark_as_read",
      arguments: { messageId: "wamid.inbound-2", typing: true },
    })) as ToolResult;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.["typing"]).toBe(true);
    expect(r.content?.[0]?.text).toMatch(/typing indicator/);
    expect(sdk.markReads[0]).toMatchObject({ messageId: "wamid.inbound-2", typing: true });
  });

  it("is window-independent — works with no inbound recorded for anyone", async () => {
    // The mock has an empty window set; a free-form send would throw
    // WINDOW_CLOSED here. markAsRead must not consult the window.
    const r = (await client.callTool({
      name: "whatsapp_mark_as_read",
      arguments: { messageId: "wamid.inbound-3" },
    })) as ToolResult;
    expect(r.isError).toBeFalsy();
  });

  it("rejects an empty messageId as a validation error (isError, not a throw)", async () => {
    const r = (await client.callTool({
      name: "whatsapp_mark_as_read",
      arguments: { messageId: "" },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(sdk.markReads).toHaveLength(0);
  });
});

describe("whatsapp_get_media_info", () => {
  it("returns metadata only — never the URL or bytes", async () => {
    const { id } = await sdk.uploadMedia({
      file: new Uint8Array(1234),
      mimeType: "image/png",
      filename: "a.png",
    });
    const r = (await client.callTool({
      name: "whatsapp_get_media_info",
      arguments: { mediaId: id },
    })) as ToolResult;
    expect(r.isError, JSON.stringify(r)).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ id, mimeType: "image/png", fileSize: 1234 });
    expect(typeof r.structuredContent?.["sha256"]).toBe("string");
    expect(Object.keys(r.structuredContent ?? {}).sort()).toEqual([
      "fileSize",
      "id",
      "mimeType",
      "sha256",
    ]);
    expect(Object.keys(r.structuredContent ?? {})).not.toContain("url");
    expect(JSON.stringify(r)).not.toContain("mock://media/");
  });

  it("maps an unknown media id to an isError with the SDK error code", async () => {
    const r = (await client.callTool({
      name: "whatsapp_get_media_info",
      arguments: { mediaId: "media.does-not-exist" },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(errorCode(r)).toBe("UNKNOWN");
  });
});

describe("whatsapp_upload_media_from_url — source URL guard (SSRF)", () => {
  it.each([
    ["http://example.com/a.png", /https/],
    ["ftp://example.com/a.png", /https/],
    ["https://user:pw@example.com/a.png", /credentials/],
    ["https://localhost/a.png", /local hostname/],
    ["https://printer.local/a.png", /local hostname/],
    ["https://127.0.0.1/a.png", /private IP/],
    ["https://10.0.0.5/a.png", /private IP/],
    ["https://169.254.169.254/latest/meta-data/", /private IP/],
    ["https://172.16.0.1/a.png", /private IP/],
    ["https://192.168.1.1/a.png", /private IP/],
    ["https://100.64.0.1/a.png", /private IP/],
    ["https://0.0.0.0/a.png", /private IP/],
    ["https://[::1]/a.png", /private IP/],
    ["https://[fe80::1]/a.png", /private IP/],
    ["https://[::ffff:10.0.0.1]/a.png", /private IP/],
  ])("refuses %s", (url, reason) => {
    const a = assessSourceUrl(url);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.reason).toMatch(reason);
  });

  it.each([
    "https://example.com/a.png",
    "https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc",
    "https://8.8.8.8/a.png",
    "https://172.15.0.1/a.png",
    "https://172.32.0.1/a.png",
  ])("accepts %s", (url) => {
    expect(assessSourceUrl(url)).toEqual({ ok: true });
  });

  it("returns isError source_url_rejected without calling fetch for a private target", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = (await client.callTool({
      name: "whatsapp_upload_media_from_url",
      arguments: { sourceUrl: "https://169.254.169.254/latest/meta-data/", mimeType: "image/png" },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(errorCode(r)).toBe("source_url_rejected");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("http:// is rejected by the guard (zod .url() alone would accept it)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = (await client.callTool({
      name: "whatsapp_upload_media_from_url",
      arguments: { sourceUrl: "http://example.com/a.png", mimeType: "image/png" },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(errorCode(r)).toBe("source_url_rejected");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("whatsapp_upload_media_from_url — fetch + upload", () => {
  it("fetches with redirect: 'error', uploads the bytes, and returns the media id", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const r = (await client.callTool({
      name: "whatsapp_upload_media_from_url",
      arguments: {
        sourceUrl: "https://cdn.example.com/out/report.pdf",
        mimeType: "application/pdf",
      },
    })) as ToolResult;

    expect(r.isError, JSON.stringify(r)).toBeFalsy();
    expect(fetchSpy).toHaveBeenCalledWith("https://cdn.example.com/out/report.pdf", {
      redirect: "error",
    });
    expect(r.structuredContent).toMatchObject({ mimeType: "application/pdf", bytes: 5 });
    expect(r.structuredContent?.["mediaId"]).toMatch(/^media\.mock-/);
    // The id is resolvable on the same SDK instance.
    const info = await sdk.downloadMedia(r.structuredContent?.["mediaId"] as string);
    expect(info.fileSize).toBe(5);
  });

  it("surfaces a non-2xx source as isError source_fetch_failed without touching Meta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));
    const r = (await client.callTool({
      name: "whatsapp_upload_media_from_url",
      arguments: { sourceUrl: "https://cdn.example.com/missing.png", mimeType: "image/png" },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(errorCode(r)).toBe("source_fetch_failed");
  });

  it("surfaces a fetch rejection (e.g. redirect refused) as isError source_fetch_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed: unexpected redirect"))
    );
    const r = (await client.callTool({
      name: "whatsapp_upload_media_from_url",
      arguments: { sourceUrl: "https://cdn.example.com/redirects.png", mimeType: "image/png" },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(errorCode(r)).toBe("source_fetch_failed");
    expect(r.content?.[0]?.text).toMatch(/Redirects are not followed/);
  });

  it("maps an oversize payload to the SDK's capability error before HTTP", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(big, { status: 200 })));
    const r = (await client.callTool({
      name: "whatsapp_upload_media_from_url",
      arguments: { sourceUrl: "https://cdn.example.com/huge.png", mimeType: "image/png" },
    })) as ToolResult;
    expect(r.isError).toBe(true);
    expect(errorCode(r)).toBe("CAPABILITY");
  });
});
