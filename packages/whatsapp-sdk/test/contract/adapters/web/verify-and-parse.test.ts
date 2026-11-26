// verifyAndParseWebhook for frameworks that own routing (e.g. an eve
// defineChannel POST route). Parity with doji-agent
// test/whatsapp/webhook.test.ts "POST signature and ack": 401 for a
// missing / wrong signature, 400 for a signed non-JSON body, 200 for
// status-only payloads.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { verifyAndParseWebhook } from "../../../../src/adapters/web/index.js";
import { computeSignature } from "../../../../src/webhooks/signature.js";

const APP_SECRET = "shh";
const FIXTURES = fileURLToPath(new URL("../../../__fixtures__/webhooks/", import.meta.url));

async function post(body: Uint8Array | string, sig: string | null): Promise<Request> {
  return new Request("https://example.test/webhook", {
    method: "POST",
    headers: sig === null ? {} : { "x-hub-signature-256": sig },
    body,
  });
}
const sign = async (body: Uint8Array | string, secret = APP_SECRET) =>
  "sha256=" + (await computeSignature(body, secret));

describe("verifyAndParseWebhook", () => {
  it("200 with parsed events and the exact verified bytes", async () => {
    const raw = new Uint8Array(await readFile(`${FIXTURES}text-inbound.json`));
    const res = await verifyAndParseWebhook(await post(raw, await sign(raw)), {
      appSecret: APP_SECRET,
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.rawBody).toEqual(raw);
    expect(res.events).toHaveLength(1);
    expect(res.events[0]).toMatchObject({ kind: "message", id: "wamid.text-1" });
  });

  it("200 and status events only for a status payload", async () => {
    const raw = new Uint8Array(await readFile(`${FIXTURES}status-sent.json`));
    const res = await verifyAndParseWebhook(await post(raw, await sign(raw)), {
      appSecret: APP_SECRET,
    });
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.events.every((e) => e.kind === "status")).toBe(true);
  });

  it("401 for a missing, wrong-secret, malformed or tampered signature", async () => {
    const raw = new Uint8Array(await readFile(`${FIXTURES}text-inbound.json`));
    const tampered = new Uint8Array(raw);
    tampered[10] = (tampered[10]! ^ 0x01) & 0xff;
    for (const req of [
      await post(raw, null),
      await post(raw, await sign(raw, "not-the-app-secret")),
      await post(raw, "sha256=deadbeef"),
      await post(tampered, await sign(raw)),
    ]) {
      expect(await verifyAndParseWebhook(req, { appSecret: APP_SECRET })).toEqual({ status: 401 });
    }
  });

  it("400 for a correctly signed body that is not JSON (or empty)", async () => {
    for (const body of ["not json", ""]) {
      const res = await verifyAndParseWebhook(await post(body, await sign(body)), {
        appSecret: APP_SECRET,
      });
      expect(res).toEqual({ status: 400 });
    }
  });

  it("401, not 400, for an unsigned non-JSON body (signature is checked first)", async () => {
    expect(
      await verifyAndParseWebhook(await post("not json", null), { appSecret: APP_SECRET })
    ).toEqual({
      status: 401,
    });
  });
});
