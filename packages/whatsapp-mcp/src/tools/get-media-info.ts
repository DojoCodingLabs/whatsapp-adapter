import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withErrorMapping } from "../errors.js";
import { registerToolOnServer } from "../register.js";
import type { CallToolResult, ToolDefinition } from "../types.js";

import type { ServerContext } from "./context.js";

export const GET_MEDIA_INFO_TOOL = "whatsapp_get_media_info" as const;

const inputSchema = {
  mediaId: z
    .string()
    .min(1)
    .describe(
      "Meta media id from an inbound webhook (`event.message[i].image.id`, `.audio.id`, etc.) or a previous upload."
    ),
};

export const MediaInfoResultSchema = z.object({
  id: z.string(),
  mimeType: z.string(),
  sha256: z.string().describe("SHA-256 hex digest of the media bytes. Stable for caching."),
  fileSize: z.number().describe("Total bytes."),
});

export const getMediaInfoDefinition: ToolDefinition = {
  name: GET_MEDIA_INFO_TOOL,
  title: "Resolve WhatsApp media metadata",
  description:
    "Look up metadata for an inbound or previously-uploaded media id. Returns `mimeType`, `sha256`, and `fileSize` — but NOT the bytes or the pre-signed URL (Meta's URL is bearer-authenticated and expires in 5 minutes, so handing it to the model is not useful). To actually process the media, your server-side code should call `client.downloadMedia(mediaId)` and proxy bytes through your own pre-signed storage.",
  inputSchema,
  outputSchema: MediaInfoResultSchema.shape,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export type GetMediaInfoArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export async function handleGetMediaInfo(
  ctx: ServerContext,
  { mediaId }: GetMediaInfoArgs
): Promise<CallToolResult> {
  return await withErrorMapping(async () => {
    const info = await ctx.client.downloadMedia(mediaId);
    return {
      content: [
        {
          type: "text",
          text: `Media ${info.id} (${info.mimeType}, ${info.fileSize} bytes, sha256=${info.sha256}). Bytes are NOT included in this response — fetch server-side and proxy via pre-signed storage.`,
        },
      ],
      structuredContent: {
        id: info.id,
        mimeType: info.mimeType,
        sha256: info.sha256,
        fileSize: info.fileSize,
      },
    };
  });
}

export function registerGetMediaInfo(server: McpServer, ctx: ServerContext): void {
  registerToolOnServer<GetMediaInfoArgs>(server, getMediaInfoDefinition, (args) =>
    handleGetMediaInfo(ctx, args)
  );
}
