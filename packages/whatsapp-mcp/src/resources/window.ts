import type { WindowTracker } from "@dojocoding/whatsapp-sdk";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ReadResourceResult, ResourceDefinition } from "../types.js";

export const WINDOW_RESOURCE_URI_TEMPLATE = "whatsapp://window/{phone}";
export const WINDOW_RESOURCE_NAME = "whatsapp-window";

export const windowResourceDefinition: ResourceDefinition = {
  name: WINDOW_RESOURCE_NAME,
  uriTemplate: WINDOW_RESOURCE_URI_TEMPLATE,
  title: "WhatsApp 24-hour window state",
  description:
    "Reads the 24-hour customer-service window state for a recipient (E.164 phone in the URI). `isOpen: false` means free-form sends will be rejected by `whatsapp_send_text` / `whatsapp_send_image` / etc., and the server should use `whatsapp_send_template` instead. If the MCP server's `WindowTracker` is unconfigured or in-memory, every read returns `isOpen: false` until inbound traffic populates the tracker.",
  mimeType: "application/json",
};

/**
 * Parses `whatsapp://window/<phone>` and reads the window state.
 * Returns a JSON-text resource body. When no tracker is wired,
 * the body has a `notice` field explaining the unconfigured
 * state so the model can interpret `isOpen: false` correctly.
 */
export async function readWindowResource(
  uri: string,
  windowTracker: WindowTracker | undefined
): Promise<ReadResourceResult> {
  // Extract the phone from `whatsapp://window/<phone>`. Tolerant
  // to leading slash and missing prefix; the toolset / server
  // bind this through URI templates so the input is already in
  // the right shape, but we re-parse defensively.
  let phone = uri;
  const marker = "whatsapp://window/";
  if (phone.startsWith(marker)) phone = phone.slice(marker.length);
  // Strip any trailing slash + URL-decode.
  phone = decodeURIComponent(phone.replace(/\/$/, ""));

  const payload = windowTracker
    ? { phone, isOpen: await windowTracker.isWindowOpen(phone) }
    : {
        phone,
        isOpen: false,
        notice:
          "No WindowTracker was wired to this MCP server. Reads are always `isOpen: false`; configure a tracker with Storage-backed state for accurate readings.",
      };

  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload),
      },
    ],
  };
}

/**
 * Resource `whatsapp://window/{phone}` — read the 24-hour
 * customer-service window state for a recipient.
 *
 * The state lives in the `WindowTracker` instance passed to the
 * SDK. If the MCP server was started without a tracker, every
 * read returns `isOpen: false`. If a tracker is present but uses
 * in-memory storage, the tracker only "knows" about a phone after
 * inbound traffic from that phone has been recorded — which
 * requires the user's app to wire its `WebhookReceiver.on("message")`
 * to `tracker.notifyInbound(e.from)`.
 *
 * The resource description above makes this visible to the model
 * so it can interpret a `false` reading correctly.
 */
export function registerWindowResource(
  server: McpServer,
  windowTracker: WindowTracker | undefined
): void {
  server.registerResource(
    WINDOW_RESOURCE_NAME,
    new ResourceTemplate(WINDOW_RESOURCE_URI_TEMPLATE, { list: undefined }),
    {
      title: windowResourceDefinition.title,
      description: windowResourceDefinition.description,
      mimeType: windowResourceDefinition.mimeType,
    },
    async (uri) => readWindowResource(uri.toString(), windowTracker)
  );
}
