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
      "Public https:// URL the server should fetch and re-upload to Meta. http://, credentials-in-URL, localhost and private/link-local IP literals are refused; redirects are not followed. Use this when your agent already produced the media at a URL (S3 pre-signed URL, generated PDF, image-gen output). MCP cannot reliably transport binary blobs through JSON-RPC stdio, so the URL-fetch indirection is the supported path."
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

/**
 * The model chooses `sourceUrl`, and this process fetches it. Without a
 * guard that is a server-side-request-forgery primitive: an agent (or a
 * prompt-injected agent) could point it at `http://169.254.169.254/…`,
 * `http://localhost:…` or an internal hostname and the bytes would be
 * uploaded to Meta as media. We accept only `https:` and refuse
 * loopback / link-local / private / unspecified literal addresses.
 * Hostnames that *resolve* to private ranges are not checked here (no
 * DNS lookup before `fetch`); deploy the server with egress rules if
 * that matters in your network.
 */
export function assessSourceUrl(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "sourceUrl is not a valid absolute URL." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `sourceUrl must use https:// (got ${url.protocol}//).` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "sourceUrl must not embed credentials." };
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: "sourceUrl must not point at a local hostname." };
  }
  if (isPrivateLiteralAddress(host)) {
    return {
      ok: false,
      reason: "sourceUrl must not point at a loopback, link-local or private IP address.",
    };
  }
  return { ok: true };
}

function isPrivateLiteralAddress(host: string): boolean {
  // IPv6 literals arrive bracketed from `URL.hostname`.
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    if (v6 === "::" || v6 === "::1") return true;
    if (v6.startsWith("fe80:") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
    // IPv4-mapped. `URL.hostname` normalises `::ffff:10.0.0.1` to the
    // hex form `::ffff:a00:1`, so accept both spellings.
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v6);
    if (dotted?.[1] !== undefined) return isPrivateV4(dotted[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(v6);
    if (hex?.[1] !== undefined && hex[2] !== undefined) {
      const hi = Number.parseInt(hex[1], 16);
      const lo = Number.parseInt(hex[2], 16);
      return isPrivateV4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    return false;
  }
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? isPrivateV4(host) : false;
}

function isPrivateV4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  const [a, b] = parts;
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed literal — refuse rather than guess
  }
  if (a === undefined || b === undefined) return true;
  if (a === 0 || a === 10 || a === 127) return true; // unspecified / 10/8 / loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 shared
  return false;
}

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
    const assessment = assessSourceUrl(sourceUrl);
    if (!assessment.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Refusing to fetch sourceUrl: ${assessment.reason} Host the file on a public https:// URL and retry.`,
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: "source_url_rejected",
            message: assessment.reason,
          },
        },
      };
    }
    // `redirect: "error"` — a 3xx to a private host would otherwise
    // bypass the guard above. Pre-signed object-storage URLs never
    // redirect; if a CDN does, the caller gets a clear isError.
    let fetched: Response;
    try {
      fetched = await fetch(sourceUrl, { redirect: "error" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Could not fetch sourceUrl (${message}); upload aborted before reaching Meta. Redirects are not followed — supply the final https:// URL.`,
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: "source_fetch_failed",
            message,
          },
        },
      };
    }
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
