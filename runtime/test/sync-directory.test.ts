import { describe, expect, test } from "bun:test";
import { syncDirectory } from "../src/runtime/sync-directory.js";

describe("directory durability barrier", () => {
  test("skips directory fsync on Windows", async () => {
    let opened = false;

    await syncDirectory("C:\\state", "win32", async () => {
      opened = true;
      throw new Error("Windows cannot fsync a directory handle");
    });

    expect(opened).toBe(false);
  });

  test("syncs and closes the directory on POSIX", async () => {
    const events: string[] = [];

    await syncDirectory("/state", "linux", async (directory, flags) => {
      events.push(`open:${directory}:${flags}`);
      return {
        sync: async () => { events.push("sync"); },
        close: async () => { events.push("close"); },
      } as never;
    });

    expect(events).toEqual(["open:/state:r", "sync", "close"]);
  });
});
