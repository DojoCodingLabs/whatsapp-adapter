import { describe, expect, it } from "vitest";

import { createWhatsAppHandler } from "../../../../src/adapters/web/index.js";
import { WebhookReceiver } from "../../../../src/webhooks/receiver.js";

const APP_SECRET = "shh";
const VERIFY_TOKEN = "ok";

describe("web handler / method routing", () => {
  const receiver = new WebhookReceiver({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN });
  const fn = createWhatsAppHandler(receiver);

  for (const method of ["PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
    it(`returns 405 for ${method}`, async () => {
      const req = new Request("https://example.test/webhook", { method });
      const res = await fn(req);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, POST");
    });
  }
});
