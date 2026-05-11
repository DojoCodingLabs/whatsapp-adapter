import { InMemoryStorage, MockWhatsAppClient, WindowTracker } from "@dojocoding/whatsapp-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TEMPLATES_CACHE_TTL_MS,
  TEMPLATES_RESOURCE_URI,
  WhatsAppMcpServer,
} from "../../src/index.js";

const PHONE = "PNID";
const WABA = "WABA";

let server: WhatsAppMcpServer | undefined;
let client: Client | undefined;

async function connect(
  sdk: MockWhatsAppClient,
  windowTracker?: WindowTracker,
  now?: () => number
): Promise<{ client: Client; server: WhatsAppMcpServer }> {
  const built = new WhatsAppMcpServer({
    client: sdk,
    wabaPhoneNumberId: PHONE,
    ...(windowTracker ? { windowTracker } : {}),
    ...(now ? { now } : {}),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "resources-test", version: "0.0.0" }, {});
  await Promise.all([built.connect(a), c.connect(b)]);
  client = c;
  server = built;
  return { client: c, server: built };
}

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

function readText(contents: ReadonlyArray<unknown>): string {
  const head = contents[0] as { text?: string } | undefined;
  if (!head || typeof head.text !== "string") {
    throw new Error(`expected text content, got ${JSON.stringify(head)}`);
  }
  return head.text;
}

function parseJsonResource(text: string): unknown {
  return JSON.parse(text) as unknown;
}

describe("whatsapp://window/{phone} resource", () => {
  it("returns isOpen=false with a notice when no WindowTracker is configured", async () => {
    const sdk = new MockWhatsAppClient({ phoneNumberId: PHONE, wabaId: WABA });
    const { client: c } = await connect(sdk);
    const result = await c.readResource({ uri: "whatsapp://window/+5210000000001" });
    expect((result.contents[0] as { mimeType?: string }).mimeType).toBe("application/json");
    const payload = parseJsonResource(readText(result.contents)) as {
      isOpen: boolean;
      notice?: string;
    };
    expect(payload.isOpen).toBe(false);
    expect(payload.notice).toMatch(/No WindowTracker/);
  });

  it("returns isOpen=false for an unseeded recipient when a tracker is wired", async () => {
    const sdk = new MockWhatsAppClient({ phoneNumberId: PHONE, wabaId: WABA });
    const tracker = new WindowTracker({
      phoneNumberId: PHONE,
      storage: new InMemoryStorage(),
    });
    const { client: c } = await connect(sdk, tracker);
    const result = await c.readResource({ uri: "whatsapp://window/+5210000000001" });
    const payload = parseJsonResource(readText(result.contents)) as {
      isOpen: boolean;
      notice?: string;
    };
    expect(payload.isOpen).toBe(false);
    expect(payload.notice).toBeUndefined();
  });

  it("returns isOpen=true after the tracker is notified of inbound traffic", async () => {
    const sdk = new MockWhatsAppClient({ phoneNumberId: PHONE, wabaId: WABA });
    const tracker = new WindowTracker({
      phoneNumberId: PHONE,
      storage: new InMemoryStorage(),
    });
    await tracker.notifyInbound("+5210000000001");
    const { client: c } = await connect(sdk, tracker);
    const result = await c.readResource({ uri: "whatsapp://window/+5210000000001" });
    const payload = parseJsonResource(readText(result.contents)) as {
      phone: string;
      isOpen: boolean;
    };
    expect(payload.phone).toBe("+5210000000001");
    expect(payload.isOpen).toBe(true);
  });
});

describe("whatsapp://templates resource", () => {
  it("serves the SDK's listTemplates response as JSON", async () => {
    const sdk = new MockWhatsAppClient({
      phoneNumberId: PHONE,
      wabaId: WABA,
      templates: [
        {
          id: "t1",
          name: "hello_world",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          components: [],
        },
      ],
    });
    const { client: c } = await connect(sdk);
    const result = await c.readResource({ uri: TEMPLATES_RESOURCE_URI });
    const payload = parseJsonResource(readText(result.contents)) as {
      data: ReadonlyArray<{ id: string; name: string }>;
      cacheTtlMs: number;
    };
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.id).toBe("t1");
    expect(payload.cacheTtlMs).toBe(TEMPLATES_CACHE_TTL_MS);
  });

  it("caches the response — back-to-back reads within 60s hit the cache, not the SDK", async () => {
    const sdk = new MockWhatsAppClient({
      phoneNumberId: PHONE,
      wabaId: WABA,
      templates: [
        {
          id: "t1",
          name: "x",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          components: [],
        },
      ],
    });
    const spy = vi.spyOn(sdk, "listTemplates");
    let clock = 1_000;
    const { client: c } = await connect(sdk, undefined, () => clock);

    await c.readResource({ uri: TEMPLATES_RESOURCE_URI });
    clock += 10_000;
    await c.readResource({ uri: TEMPLATES_RESOURCE_URI });
    clock += 30_000;
    await c.readResource({ uri: TEMPLATES_RESOURCE_URI });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("evicts the cache when 60s elapses", async () => {
    const sdk = new MockWhatsAppClient({
      phoneNumberId: PHONE,
      wabaId: WABA,
      templates: [
        {
          id: "t1",
          name: "x",
          language: "en_US",
          category: "UTILITY",
          status: "APPROVED",
          components: [],
        },
      ],
    });
    const spy = vi.spyOn(sdk, "listTemplates");
    let clock = 1_000;
    const { client: c } = await connect(sdk, undefined, () => clock);

    await c.readResource({ uri: TEMPLATES_RESOURCE_URI });
    clock += TEMPLATES_CACHE_TTL_MS + 1;
    await c.readResource({ uri: TEMPLATES_RESOURCE_URI });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
