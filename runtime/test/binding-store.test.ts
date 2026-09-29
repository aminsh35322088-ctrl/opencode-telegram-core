import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AtomicBindingStore,
  BindingIntegrityError,
  type BindingIdentity,
} from "../src/index.js";

function binding(id = "a", threadId = 11): BindingIdentity {
  return {
    bindingId: id,
    botId: "bot-main",
    chatId: 100,
    threadId,
    sessionId: "session-" + id,
    normalizedDirectory: "/workspace/" + id,
    bindingGeneration: 1,
  };
}

describe("atomic durable binding store", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  test("fence is persisted before reload and generation is never reused", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-bindings-"));
    const file = path.join(root, "bindings.json");
    const store = new AtomicBindingStore(file);
    await store.load();
    await store.register(binding());

    const fenced = await store.fence("a");
    expect(fenced.bindingGeneration).toBe(2);

    const reloaded = new AtomicBindingStore(file);
    await reloaded.load();
    expect(reloaded.registry.getById("a")?.bindingGeneration).toBe(2);
  });

  test("load is idempotent and can be repeated on one store", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-bindings-"));
    const file = path.join(root, "bindings.json");
    const store = new AtomicBindingStore(file);
    await store.load();
    await store.register(binding());

    // Reloading the same store must reload from disk, not collide with the
    // records the previous load installed.
    await store.load();
    await store.load();
    expect(store.registry.getById("a")).not.toBeNull();
    expect(store.registry.list()).toHaveLength(1);
  });

  test("ambiguous duplicate route fails before persistent file is changed", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-bindings-"));
    const file = path.join(root, "bindings.json");
    const store = new AtomicBindingStore(file);
    await store.register(binding("a", 11));
    const before = await readFile(file, "utf8");

    await expect(store.register(binding("b", 11))).rejects.toBeInstanceOf(BindingIntegrityError);
    expect(await readFile(file, "utf8")).toBe(before);
  });

  test("incomplete delete reloads as tombstone and never resurrects route", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-bindings-"));
    const file = path.join(root, "bindings.json");
    const store = new AtomicBindingStore(file);
    await store.register(binding());
    const tombstone = await store.beginDelete("a");
    expect(tombstone.bindingGeneration).toBe(2);
    expect(store.registry.getById("a")).toBeNull();

    const reloaded = new AtomicBindingStore(file);
    await reloaded.load();
    expect(reloaded.registry.getById("a")).toBeNull();
    expect(reloaded.pendingDeletes()).toHaveLength(1);
    expect(reloaded.pendingDeletes()[0]?.bindingGeneration).toBe(2);

    await reloaded.completeDelete("a");
    const finalReload = new AtomicBindingStore(file);
    await finalReload.load();
    expect(finalReload.pendingDeletes()).toHaveLength(0);
  });

  test("non-canonical directory is rejected fail-closed", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-bindings-"));
    const store = new AtomicBindingStore(path.join(root, "bindings.json"));
    await expect(store.register({
      ...binding(),
      normalizedDirectory: "/workspace/a/../b",
    })).rejects.toBeInstanceOf(BindingIntegrityError);
  });

  test("concurrent mutations are serialized so reload never drops a completed write", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-bindings-"));
    const file = path.join(root, "bindings.json");
    const store = new AtomicBindingStore(file);
    await store.load();
    await store.register(binding("a", 11));

    await Promise.all([
      store.register(binding("b", 12)),
      store.beginDelete("a"),
    ]);

    const reloaded = new AtomicBindingStore(file);
    await reloaded.load();
    expect(reloaded.registry.getById("b")).not.toBeNull();
    expect(reloaded.pendingDeletes()).toHaveLength(1);
    expect(reloaded.pendingDeletes()[0]?.bindingId).toBe("a");
  });
});
