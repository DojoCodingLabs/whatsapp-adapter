import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import type { ServerContext } from "./context.js";

export const UPLOAD_MEDIA_FROM_URL_TOOL = "whatsapp_upload_media_from_url" as const;

const inputSchema = {
  sourceUrl: z
    .string()
    .url()
    .describe(
      "Public HTTPS URL the SDK should fetch and re-upload to Meta. Use this when your agent already produced the media at a URL (S3 pre-signed URL, generated PDF, image-gen output). MCP cannot reliably transport binary blobs through JSON-RPC stdio, so the URL-fetch indirection is the supported path."
    ),
  mimeType: z
    .string()
    .min(1)
    .describe(
      "MIME type Meta should record for the media (e.g. `image/jpeg`, `application/pdf`). Must match the actual bytes."
    ),
  filename: z
    .string()
    .optional()
    .describe(
      "Optional filename shown to the recipient for document sends. Defaults to the URL's last path segment."
    ),
};

export const UploadMediaResultSchema = z.object({
  mediaId: z.string().describe("Meta-issued media id, reusable in subsequent send tools."),
  mimeType: z.string(),
  bytes: z.number().describe("Total bytes uploaded."),
});

export const uploadMediaFromUrlDefinition: ToolDefinition = {
  name: UPLOAD_MEDIA_FROM_URL_TOOL,
  title: "Upload WhatsApp media from a public URL",
  description:
    "Fetch a public HTTPS URL server-side and upload its bytes to Meta as a reusable media id. Use this when you want `whatsapp_send_image` / `whatsapp_send_document` / etc. to reference content the agent has prepared (generated PDF, screenshot, etc.) rather than re-hosting it elsewhere. The MCP server fetches the URL itself — the agent does NOT need to read or pass the bytes. Size guards: image 5 MB, audio/video 16 MB, document 100 MB.",
  inputSchema,
  outputSchema: UploadMediaResultSchema.shape,
  annotations: {
    // Not strictly idempotent — each call issues a fresh media id —
    // but the call has no side effect on the recipient until paired
    // with a send.
    idempotentHint: false,
  },
};

export type UploadMediaFromUrlArgs = z.infer<z.ZodObject<typeof inputSchema>>;

function inferFilenameFromUrl(rawUrl: string, fallback: string): string {
  try {
    const u = new URL(rawUrl);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (typeof last === "string" && last.length > 0) return last;
  } catch {
    // fall through to fallback
  }
  return fallback;
}

export async function handleUploadMediaFromUrl(
  ctx: ServerContext,
  { sourceUrl, mimeType, filename }: UploadMediaFromUrlArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const fetched = await fetch(sourceUrl);
    if (!fetched.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Source URL returned ${fetched.status}; upload aborted before reaching Meta. Verify the URL is publicly reachable.`,
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: "source_fetch_failed",
            message: `${fetched.status} from sourceUrl`,
          },
        },
      };
    }
    const buf = new Uint8Array(await fetched.arrayBuffer());
    const resolvedFilename = filename ?? inferFilenameFromUrl(sourceUrl, "upload");
    const { id } = await ctx.client.uploadMedia({
      file: buf,
      mimeType,
      filename: resolvedFilename,
    });
    return {
      content: [
        {
          type: "text",
          text: `Uploaded ${buf.byteLength} bytes (${mimeType}) as media ${id}. Use it as \`mediaId\` in a subsequent send tool.`,
        },
      ],
      structuredContent: {
        mediaId: id,
        mimeType,
        bytes: buf.byteLength,
      },
    };
  });
}

export function registerUploadMediaFromUrl(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<UploadMediaFromUrlArgs>(server, uploadMediaFromUrlDefinition, (args) =>
    handleUploadMediaFromUrl(ctx, args)
  );
}
