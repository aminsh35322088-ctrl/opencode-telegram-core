import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const CHUNK_BYTES = 512 * 1024;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

async function control(args: Record<string, unknown>, sessionId: string): Promise<any> {
  const response = await fetch("http://127.0.0.1:4098/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "telegram.tool", sessionId, payload: args }),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => null) as { ok?: boolean; result?: unknown } | null;
  if (!response.ok || !value || value.ok !== true) throw new Error("Telegram Topic capability rejected the request.");
  return value.result;
}

function safeRelativePath(raw: string): string {
  const normalized = raw.trim().replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((part) => part === "..")) {
    throw new Error("Telegram media output must stay inside the current Topic workspace.");
  }
  return normalized;
}

export default {
  description: "Read safe metadata for the Telegram message that triggered this Topic, inspect its reply/forward metadata, or fetch current/replied media through the Control Plane's bounded Telegram file-transfer bridge. The bot token never enters the Worker.",
  args: {
    action: { type: "string", enum: ["context.current", "reply.resolve", "forward.inspect", "media.fetch"] },
    target: { type: "string", enum: ["current", "reply"] },
    index: { type: "number" },
    output: { type: "string" },
  },
  async execute(args: { action?: string; target?: "current" | "reply"; index?: number; output?: string }, context: { sessionID: string; directory?: string; worktree?: string }) {
    const sessionId = context.sessionID;
    if (!sessionId) throw new Error("Telegram context requires the current Topic session.");
    const action = args.action;
    if (action === "context.current" || action === "reply.resolve" || action === "forward.inspect") {
      return JSON.stringify(await control({ action }, sessionId), null, 2);
    }
    if (action !== "media.fetch") throw new Error("Unsupported Telegram context action.");
    const target = args.target === "reply" ? "reply" : "current";
    const index = Math.trunc(args.index ?? 0);
    if (!Number.isSafeInteger(index) || index < 0 || index > 5) throw new Error("Media index must be between 0 and 5.");
    const transfer = await control({ action: "media.begin", target, index }, sessionId) as { transferId?: string; filename?: string; mimeType?: string; size?: number };
    if (!transfer || typeof transfer.transferId !== "string" || typeof transfer.filename !== "string" ||
      !Number.isSafeInteger(transfer.size) || transfer.size! < 1 || transfer.size! > MAX_MEDIA_BYTES) {
      throw new Error("Telegram media transfer metadata is invalid or exceeds the 20 MB limit.");
    }
    const base = await fs.realpath(context.directory || context.worktree || process.cwd());
    const filename = path.basename(transfer.filename).replace(/[^a-zA-Z0-9._-]/gu, "_") || `telegram-media-${Date.now()}`;
    const relative = safeRelativePath(args.output?.trim() || path.posix.join(".telegram", "fetched", filename));
    const destination = path.resolve(base, relative);
    const targetRelative = path.relative(base, destination);
    if (targetRelative.startsWith("..") || path.isAbsolute(targetRelative)) throw new Error("Telegram media output escapes the current workspace.");
    const parentPath = path.dirname(destination);
    await fs.mkdir(parentPath, { recursive: true });
    const parentReal = await fs.realpath(parentPath);
    const parentRelative = path.relative(base, parentReal);
    if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) throw new Error("Telegram media output parent escapes the current workspace.");
    const temporary = `${destination}.${randomUUID()}.part`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    let offset = 0;
    try {
      handle = await fs.open(temporary, "wx", 0o600);
      while (offset < transfer.size!) {
        const chunk = await control({ action: "media.chunk", transferId: transfer.transferId, offset, limit: CHUNK_BYTES }, sessionId) as {
          offset?: number; nextOffset?: number; size?: number; eof?: boolean; data?: string;
        };
        if (!chunk || chunk.offset !== offset || chunk.size !== transfer.size || typeof chunk.data !== "string" ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(chunk.data)) throw new Error("Telegram media chunk is invalid.");
        const bytes = Buffer.from(chunk.data, "base64");
        if (!bytes.length || bytes.length > CHUNK_BYTES || chunk.nextOffset !== offset + bytes.length || chunk.nextOffset > transfer.size || chunk.eof !== (chunk.nextOffset >= transfer.size)) {
          throw new Error("Telegram media chunk bounds are invalid.");
        }
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written, offset + written);
          if (result.bytesWritten <= 0) throw new Error("Could not persist Telegram media chunk.");
          written += result.bytesWritten;
        }
        offset = chunk.nextOffset;
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      const stat = await fs.stat(temporary);
      if (!stat.isFile() || stat.size !== transfer.size) throw new Error("Telegram media transfer size verification failed.");
      // Link creation is atomic and fails if the destination already exists; unlike
      // rename(), it never silently overwrites a workspace file or follows a symlink.
      await fs.link(temporary, destination);
      await fs.unlink(temporary);
      return JSON.stringify({ ok: true, path: destination, filename, mimeType: transfer.mimeType ?? "application/octet-stream", bytes: stat.size }, null, 2);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
      await control({ action: "media.finish", transferId: transfer.transferId }, sessionId).catch(() => undefined);
    }
  },
};
