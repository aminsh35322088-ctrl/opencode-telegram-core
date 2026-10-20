import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { lstat, mkdir, open, realpath, link, unlink, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0]!;
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    const [a, b, c] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) || (a === 192 && b === 88 && c === 99);
  }
  if (isIP(normalized) === 6) {
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff")) return true;
    if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
    return false;
  }
  return true;
}

async function validatePublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || !url.hostname) throw new Error("Only public HTTP(S) URLs without embedded credentials are allowed.");
  const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("Private or local network destinations are not allowed.");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("URL resolves to a private or reserved network address.");
  return url;
}

export default {
  description: "Download a public HTTP(S) file into the current Topic workspace. Validates every redirect target, rejects private/local network destinations, streams to disk, and enforces a hard 50 MB limit.",
  args: {
    action: { type: "string", enum: ["download"] },
    url: { type: "string" },
    filename: { type: "string" },
    timeoutMs: { type: "number" },
  },
  async execute(args: { action?: string; url?: string; filename?: string; timeoutMs?: number }, context: { directory?: string; worktree?: string }) {
    if (args.action !== "download" || typeof args.url !== "string" || typeof args.filename !== "string" || !args.filename.trim()) throw new Error("safe-download requires action=download, url and filename.");
    const base = await realpath(context.directory || context.worktree || process.cwd());
    const destination = path.resolve(base, args.filename);
    const relative = path.relative(base, destination);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Download destination must stay inside the current Topic workspace.");
    const timeout = Math.max(5_000, Math.min(Math.trunc(args.timeoutMs ?? DEFAULT_TIMEOUT_MS), 300_000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const temporary = `${destination}.${randomUUID()}.part`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      let url = await validatePublicUrl(args.url);
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "User-Agent": "OpenCode-Agent/1.0" } });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects === 5) throw new Error("Download redirect chain is invalid or too long.");
        url = await validatePublicUrl(new URL(location, url).toString());
      }
      if (!response?.ok) throw new Error(`Download failed with HTTP ${response?.status ?? "unknown"}.`);
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) throw new Error("Download exceeds the 50 MB limit.");
      if (!response.body) throw new Error("Download response has no body.");
      await mkdir(path.dirname(destination), { recursive: true });
      const parent = await realpath(path.dirname(destination));
      const parentRelative = path.relative(base, parent);
      if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) throw new Error("Download parent resolves outside the current Topic workspace.");
      const prior = await lstat(destination).catch(() => null);
      if (prior?.isSymbolicLink() || prior?.isDirectory()) throw new Error("Download destination must not be a symlink or directory.");
      handle = await open(temporary, "wx", 0o600);
      const reader = response.body.getReader();
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_DOWNLOAD_BYTES) throw new Error("Download exceeded the 50 MB limit.");
          let offset = 0;
          while (offset < value.byteLength) {
            const written = await handle.write(value, offset, value.byteLength - offset);
            if (written.bytesWritten <= 0) throw new Error("Unable to persist downloaded data.");
            offset += written.bytesWritten;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (total <= 0) throw new Error("Refusing to save an empty download.");
      await handle.sync();
      await handle.close();
      handle = undefined;
      // Publish without replacing an existing file, including a symlink.
      await link(temporary, destination);
      await unlink(temporary);
      return JSON.stringify({ ok: true, url: url.toString(), path: destination, bytes: total, limitBytes: MAX_DOWNLOAD_BYTES }, null, 2);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
      clearTimeout(timer);
    }
  },
};
