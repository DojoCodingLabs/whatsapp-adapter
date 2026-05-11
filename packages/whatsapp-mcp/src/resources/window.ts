import type { WindowTracker } from "@dojocoding/whatsapp-sdk";
import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

export const WINDOW_RESOURCE_URI_TEMPLATE = "whatsapp://window/{phone}";
export const WINDOW_RESOURCE_NAME = "whatsapp-window";

/**
 * Resource `whatsapp://window/{phone}` — read the 24-hour
 * customer-service window state for a recipient.
 *
 * Honest caveat: the state lives in the `WindowTracker` instance
 * passed to the SDK. If the MCP server was started without a
 * tracker, every read returns `isOpen: false`. If a tracker is
 * present but uses in-memory storage, the tracker only "knows"
 * about a phone after inbound traffic from that phone has been
 * recorded — which requires the user's app to wire its
 * `WebhookReceiver.on("message")` to `tracker.notifyInbound(e.from)`.
 *
 * The resource description below makes this visible to the model
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
      title: "WhatsApp 24-hour window state",
      description:
        "Reads the 24-hour customer-service window state for a recipient (E.164 phone in the URI). `isOpen: false` means free-form sends will be rejected by `whatsapp_send_text` / `whatsapp_send_image` / etc., and the server should use `whatsapp_send_template` instead. If the MCP server's `WindowTracker` is unconfigured or in-memory, every read returns `isOpen: false` until inbound traffic populates the tracker.",
      mimeType: "application/json",
    },
    async (uri, { phone }) => {
      const phoneStr = Array.isArray(phone) ? phone[0] : phone;
      const payload = windowTracker
        ? { phone: phoneStr, isOpen: await windowTracker.isWindowOpen(phoneStr ?? "") }
        : {
            phone: phoneStr,
            isOpen: false,
            notice:
              "No WindowTracker was wired to this MCP server. Reads are always `isOpen: false`; configure a tracker with Storage-backed state for accurate readings.",
          };
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(payload),
          },
        ],
      };
    }
  );
}
