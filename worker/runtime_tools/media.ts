import { promises as fs } from "node:fs";
import path from "node:path";
const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK = 512 * 1024;
type Transfer = { transferId: string; filename: string; mimeType: string; size: number };
type Context = { sessionID: string; directory?: string; worktree?: string };
function required(value: unknown, name: string): string { const result = typeof value === "string" ? value.trim() : ""; if (!result) throw new Error(`${name} is required.`); return result; }
function inside(rootValue: string, value: string): string { if (/[\0\r\n]/u.test(value)) throw new Error("Media path contains control characters."); const root = path.resolve(rootValue); const target = path.resolve(root, value); const relative = path.relative(root, target); if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Media output must stay inside the current Topic workspace."); return target; }
function extension(mime: string): string { return mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : mime === "image/gif" ? ".gif" : mime === "audio/ogg" ? ".ogg" : ".png"; }
async function control(ctx: Context, action: string, fields: Record<string, unknown> = {}): Promise<unknown> {
  const response = await fetch("http://127.0.0.1:4098/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "telegram.tool", sessionId: ctx.sessionID, payload: { action, ...fields } }), signal: AbortSignal.timeout(190_000) });
  const value = await response.json().catch(() => null) as { ok?: boolean; result?: unknown } | null;
  if (!response.ok || !value || value.ok !== true) throw new Error(`Topic-scoped media action rejected: ${action}. Check this Topic's media capability configuration.`);
  return value.result;
}
async function saveTransfer(ctx: Context, raw: unknown, relativePath: string): Promise<string> {
  if (!raw || typeof raw !== "object") throw new Error("Invalid media transfer metadata.");
  const t = raw as Transfer;
  if (typeof t.transferId !== "string" || !t.transferId || typeof t.filename !== "string" || typeof t.mimeType !== "string" || !Number.isSafeInteger(t.size) || t.size < 1 || t.size > MAX_BYTES) throw new Error("Media transfer metadata failed validation.");
  const destination = inside(ctx.directory || ctx.worktree || process.cwd(), relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined; let offset = 0; let complete = false;
  try {
    handle = await fs.open(destination, "wx", 0o600);
    while (offset < t.size) {
      const rawChunk = await control(ctx, "media.chunk", { transferId: t.transferId, offset, limit: Math.min(CHUNK, t.size - offset) });
      if (!rawChunk || typeof rawChunk !== "object") throw new Error("Invalid media chunk.");
      const c = rawChunk as { offset?: number; nextOffset?: number; size?: number; eof?: boolean; data?: string };
      if (c.offset !== offset || c.size !== t.size || typeof c.data !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(c.data)) throw new Error("Media chunk offset/size mismatch.");
      const bytes = Buffer.from(c.data, "base64");
      if (!bytes.length || bytes.length > CHUNK || c.nextOffset !== offset + bytes.length || c.nextOffset > t.size || c.eof !== (c.nextOffset >= t.size)) throw new Error("Media chunk length mismatch.");
      let written = 0;
      while (written < bytes.length) {
        const result = await handle.write(bytes, written, bytes.length - written, offset + written);
        if (result.bytesWritten <= 0) throw new Error("Could not persist media chunk.");
        written += result.bytesWritten;
      }
      offset = c.nextOffset;
    }
    complete = offset === t.size;
    if (!complete) throw new Error("Media transfer was incomplete.");
    await handle.sync();
    const stat = await fs.stat(destination);
    if (!stat.isFile() || stat.size !== t.size) throw new Error("Media transfer size verification failed.");
    return destination;
  } finally {
    if (handle) await handle.close();
    await control(ctx, "media.finish", { transferId: t.transferId }).catch(() => undefined);
    if (handle && !complete) await fs.rm(destination, { force: true }).catch(() => undefined);
  }
}

export default {
  description: "Topic-bound Telegram media: transcribe the current/replied voice, prepare video frames, inspect Image AI configuration, generate or edit an image with the configured Image Model, and deliver generated images inline in the same Telegram Topic. Transfers are chunked, size-limited, and tied to the current Worker/session.",
  args: {
    action: { type: "string", enum: ["stt.status", "stt.transcribe", "video.prepare", "image.providers", "image.models", "image.current", "image.generate", "image.edit"] },
    target: { type: "string", enum: ["current", "reply"] }, index: { type: "number" }, prompt: { type: "string" }, output: { type: "string" },
  },
  async execute(args: { action?: string; target?: string; index?: number; prompt?: string; output?: string }, context: Context) {
    const action = required(args.action, "action");
    const target = args.target === "reply" ? "reply" : "current";
    const index = Number.isSafeInteger(args.index) && (args.index as number) >= 0 && (args.index as number) <= 5 ? args.index as number : 0;
    if (["image.providers", "image.models", "image.current", "stt.status"].includes(action)) return JSON.stringify(await control(context, action), null, 2);
    if (action === "stt.transcribe") return JSON.stringify(await control(context, action, { target, index }), null, 2);
    const root = context.directory || context.worktree || process.cwd();
    if (action === "image.generate" || action === "image.edit") {
      const prompt = required(args.prompt, "prompt");
      const metadata = await control(context, action, { prompt, ...(action === "image.edit" ? { target, index } : {}) }) as Record<string, unknown>;
      const ext = extension(String(metadata.mimeType ?? "application/octet-stream"));
      const raw = args.output?.trim() || `artifacts/image-${Date.now()}${ext}`;
      const saved = await saveTransfer(context, metadata, path.extname(raw) ? raw : `${raw}${ext}`);
      return `${JSON.stringify({ ok: true, path: saved, mimeType: metadata.mimeType, selection: metadata.selection ?? null }, null, 2)}\n__TELEGRAM_ARTIFACT__ ${saved}`;
    }
    if (action === "video.prepare") {
      const result = await control(context, action, { target, index }) as { source?: string; frames?: Transfer[]; audio?: Transfer | null };
      if (!Array.isArray(result.frames) || result.frames.length > 12) throw new Error("Video frame transfer metadata is invalid.");
      const dirValue = args.output?.trim() || `artifacts/video-${Date.now()}`;
      const dir = inside(root, dirValue); await fs.mkdir(dir, { recursive: true });
      const framePaths: string[] = [];
      for (const frame of result.frames) framePaths.push(await saveTransfer(context, frame, path.join(path.relative(root, dir), path.basename(frame.filename))));
      const audioPath = result.audio ? await saveTransfer(context, result.audio, path.join(path.relative(root, dir), path.basename(result.audio.filename))) : null;
      return JSON.stringify({ ok: true, source: result.source ?? null, frames: framePaths, audio: audioPath }, null, 2);
    }
    throw new Error(`Unsupported media action: ${action}`);
  },
};
