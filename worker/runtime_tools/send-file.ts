import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MARKER = "__TELEGRAM_ARTIFACT__";
const SENSITIVE_SEGMENTS = new Set([".ssh", ".aws", ".azure", ".gnupg"]);

function isSensitive(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/").toLowerCase();
  const basename = path.posix.basename(normalized);
  if (normalized.split("/").some((segment) => SENSITIVE_SEGMENTS.has(segment))) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (basename === "credentials" || basename === "credentials.json" || basename === "token" || basename === "tokens.json") return true;
  return basename.endsWith(".pem") || basename.endsWith(".key") || basename === "id_rsa" || basename === "id_ed25519";
}

export default {
  description: "Send a regular file from the current Topic workspace to Telegram. The Control Plane transfers it through the authenticated Topic Worker bridge; credential-like files and paths outside this workspace are refused.",
  args: {
    action: { type: "string", enum: ["send"] },
    path: { type: "string" },
    caption: { type: "string" },
  },
  async execute(args: { action?: string; path?: string; caption?: string }, context: { directory?: string; worktree?: string }) {
    if (args.action !== "send" || typeof args.path !== "string" || !args.path.trim()) throw new Error("send-file requires action=send and a path.");
    const base = await realpath(context.directory || context.worktree || process.cwd());
    const target = path.resolve(base, args.path);
    const relative = path.relative(base, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("File must be inside the current Topic workspace.");
    if (isSensitive(relative)) throw new Error("Refusing to send a sensitive or credential-like file.");
    const metadata = await lstat(target).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error("File does not exist or is not a safe regular file.");
    const resolved = await realpath(target);
    const resolvedRelative = path.relative(base, resolved);
    if (resolvedRelative.startsWith("..") || path.isAbsolute(resolvedRelative)) throw new Error("File resolves outside the current Topic workspace.");
    if (metadata.size <= 0 || metadata.size > MAX_FILE_SIZE_BYTES) throw new Error("File must be between 1 byte and 50 MB.");
    const caption = typeof args.caption === "string" ? args.caption.trim().slice(0, 900) : "";
    const marker = `${MARKER} ${resolved}`;
    return { title: `Send ${path.basename(resolved)}`, output: caption ? `${marker}\n${caption}` : marker };
  },
};
