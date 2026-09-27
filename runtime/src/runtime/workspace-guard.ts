import path from "node:path";
import { realpath } from "node:fs/promises";

export class WorkspaceEscapeError extends Error {
  constructor(readonly requestedPath: string, readonly workspaceRoot: string) {
    super(`path escapes workspace: ${requestedPath}`);
    this.name = "WorkspaceEscapeError";
  }
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function assertWorkspacePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  const root = await realpath(workspaceRoot);
  const candidate = await realpath(path.resolve(root, requestedPath));
  if (!inside(root, candidate)) throw new WorkspaceEscapeError(requestedPath, root);
  return candidate;
}
