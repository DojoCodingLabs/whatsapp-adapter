/**
 * v1.0.0 smoke script — see docs/_internal/v1-smoke-test.md.
 *
 * Sends one real `hello_world` template to a verified Meta
 * recipient via the real `WhatsAppClient`. Confirms the SDK
 * end-to-end against real Meta credentials before tagging
 * v1.0.0. Templates are window-exempt, so the recipient does
 * not need an open 24-hour customer-service window for this
 * send to succeed.
 *
 * Required env:
 *   WHATSAPP_ACCESS_TOKEN
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_BUSINESS_ACCOUNT_ID
 *   SMOKE_TO            (verified recipient phone, E.164)
 *
 * Usage:
 *   node docs/_internal/v1-smoke-script.mjs
 *
 * Exit codes:
 *   0 — send succeeded; wamid printed
 *   1 — missing env / SDK error / Meta rejected
 *
 * Plain ESM .mjs on purpose — operational artefact runnable on
 * any Node 20+ without type-stripping flags or build steps.
 */

import { WhatsAppClient } from "@dojocoding/whatsapp-sdk";

function requireEnv(key) {
  const value = process.env[key];
  if (typeof value !== "string" || value.length === 0) {
    process.stderr.write(`[smoke] FATAL: ${key} not set\n`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const accessToken = requireEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const wabaId = requireEnv("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const to = requireEnv("SMOKE_TO");

  process.stderr.write(`[smoke] sending hello_world (en_US) to ${to} via PNID ${phoneNumberId}\n`);

  const client = new WhatsAppClient({
    phoneNumberId,
    wabaId,
    token: accessToken,
    appSecret: "", // not used for outbound
  });

  const response = await client.sendTemplate({
    to,
    name: "hello_world",
    language: "en_US",
  });

  const wamid = response.messages[0]?.id;
  if (typeof wamid !== "string") {
    process.stderr.write(
      `[smoke] FATAL: Meta returned 2xx but no wamid: ${JSON.stringify(response)}\n`
    );
    process.exit(1);
  }

  // Refuse to mistake a mock wamid for a real one. The mock
  // emits wamid.mock-N; real Meta emits wamid.HBgL... (B64).
  if (wamid.startsWith("wamid.mock-")) {
    process.stderr.write(
      `[smoke] FATAL: got a MOCK wamid (${wamid}). Did WHATSAPP_MODE=mock leak in? Check env.\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `[smoke] SUCCESS — wamid=${wamid}  recipient=${to}  template=hello_world  language=en_US\n`
  );
  process.stderr.write(`[smoke] check your recipient phone for the delivered message\n`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[smoke] FATAL: ${message}\n`);
  if (err instanceof Error && err.stack !== undefined) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
