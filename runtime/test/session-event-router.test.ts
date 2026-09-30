import { describe, expect, test } from "bun:test";
import path from "node:path";
import { BindingRegistry } from "../src/runtime/binding-registry.js";
import { RunRegistry } from "../src/runtime/run-registry.js";
import type { BindingIdentity } from "../src/runtime/identity.js";
import { SessionEventRouter } from "../src/opencode/session-event-router.js";

const directory = path.resolve("workspace");
function binding(id: string, threadId: number): BindingIdentity {
  return { bindingId: id, botId: "bot", chatId: 100, threadId,
    sessionId: "session-" + id, normalizedDirectory: directory, bindingGeneration: 1 };
}

describe("SessionEventRouter", () => {
  test("routes exact sessions and rejects directory ambiguity or a foreign directory", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    bindings.register(binding("a", 11));
    bindings.register(binding("b", 22));
    const router = new SessionEventRouter(bindings, runs);
    expect((await router.resolve("session-a", directory))?.bindingId).toBe("a");
    expect(await router.resolve("session-a", path.resolve("foreign"))).toBeNull();
    expect(await router.resolve(null, directory)).toBeNull();
    expect(await router.resolve("unknown", directory)).toBeNull();
  });

  test("uses session ancestry rather than guessing from a unique directory", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const a = binding("a", 11);
    bindings.register(a);
    runs.start(a, 1, "run-a");
    const parents = new Map([ ["child", "session-a"], ["nested", "child"] ]);
    const router = new SessionEventRouter(bindings, runs, async (id) => parents.get(id) ?? null);
    expect(await router.resolve("old-root", directory)).toBeNull();
    expect((await router.resolve("child", directory))?.bindingId).toBe("a");
    expect((await router.resolve("nested", directory))?.bindingId).toBe("a");
    runs.fence("a");
    expect(await router.resolve("child", directory)).toBeNull();
  });

  test("keeps children with their parent when Topics share a directory", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const a = binding("a", 11);
    const b = binding("b", 22);
    bindings.register(a);
    bindings.register(b);
    runs.start(a, 1, "run-a");
    runs.start(b, 1, "run-b");
    const router = new SessionEventRouter(bindings, runs, async () => "session-b");
    expect((await router.resolve("child-b", directory))?.threadId).toBe(22);
  });

  test("rejects a parent session bound to two Topics even if only one has a run", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const a = binding("a", 11);
    bindings.register(a);
    bindings.register({ ...binding("b", 22), sessionId: a.sessionId });
    runs.start(a, 1);
    const router = new SessionEventRouter(bindings, runs, async () => a.sessionId);
    expect(await router.resolve("child", directory)).toBeNull();
  });

  test("rejects an ancestry lookup that overlaps binding rotation or run replacement", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const a = binding("a", 11);
    bindings.register(a);
    runs.start(a, 1, "run-a");
    let release!: (parent: string | null) => void;
    const router = new SessionEventRouter(bindings, runs, () => new Promise(resolve => { release = resolve; }));
    const pending = router.resolve("child", directory);
    runs.fence("a");
    runs.start(a, 1, "run-b");
    release("session-a");
    expect(await pending).toBeNull();

    const pendingRotation = router.resolve("another-child", directory);
    bindings.replace({ ...a, sessionId: "session-new", bindingGeneration: 2 }, 1);
    runs.fence("a");
    release("session-a");
    expect(await pendingRotation).toBeNull();
  });

  test("fails closed on cyclic ancestry and lookup failures", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const a = binding("a", 11);
    bindings.register(a);
    runs.start(a, 1);
    const cyclic = new SessionEventRouter(bindings, runs, async () => "child");
    expect(await cyclic.resolve("child", directory)).toBeNull();
    const failing = new SessionEventRouter(bindings, runs, async () => { throw new Error("offline"); });
    expect(await failing.resolve("child", directory)).toBeNull();
  });
});
