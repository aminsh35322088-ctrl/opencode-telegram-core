import { open } from "node:fs/promises";

/**
 * Persist directory-entry changes where the platform supports directory fsync.
 * Windows does not allow opening a directory handle for fsync, and the rename
 * has already made the file visible there.
 */
export async function syncDirectory(
  directory: string,
  platform: NodeJS.Platform = process.platform,
  openDirectory: typeof open = open,
): Promise<void> {
  if (platform === "win32") return;

  const handle = await openDirectory(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
