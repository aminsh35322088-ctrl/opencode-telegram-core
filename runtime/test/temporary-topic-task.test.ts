import { expect, test } from "bun:test";
import path from "node:path";
import { OpenCodeTopicWorker, type RunIdentity, type TemporarySessionPort } from "../src/index.js";

const run: RunIdentity = { bindingId: "topic", botId: "bot", chatId: 1, threadId: 2,
  sessionId: "parent", normalizedDirectory: path.resolve("/workspace/topic"),
  bindingGeneration: 1, workerGeneration: 1, runId: "run" };

function fixture(overrides: Partial<TemporarySessionPort> = {}) {
  const aborted: string[] = [];
  const removed: string[] = [];
  const port: TemporarySessionPort = {
    get: async (owner) => owner,
    create: async (owner) => ({ ...owner, sessionId: "child", parentSessionId: owner.sessionId }),
    abort: async (target) => { aborted.push(target.sessionId); },
    remove: async (target) => { removed.push(target.sessionId); },
    ...overrides,
  };
  const worker = new OpenCodeTopicWorker(run, 1, null, {
    promptTimeoutMs: 1_000, cancellationGraceMs: 10, stopTimeoutMs: 30,
    abortSession: async (target) => { aborted.push(target.sessionId); }, temporarySessionPort: port,
  });
  return { worker, aborted, removed };
}

test("child scope excludes manual target changes and nested scopes, then restores its owner", async () => {
  const { worker, aborted, removed } = fixture();
  await worker.start(run);
  await worker.executeTask(run, "child", async (context) => {
    await context.withTemporarySession({ title: "child" }, async (child) => {
      expect(child.parentSessionId).toBe(run.sessionId);
      expect(() => context.setAbortTarget(null)).toThrow("owns the abort target");
      await expect(context.withTemporarySession({ title: "nested" }, async () => {})).rejects.toThrow("active temporary");
    });
  });
  await worker.stop("parent stop");
  expect(aborted).toEqual(["child", "parent"]);
  expect(removed).toEqual(["child"]);
});

test("catching child cleanup failure cannot report success or reuse its worker", async () => {
  const { worker, aborted, removed } = fixture({ abort: async () => { throw new Error("abort unavailable"); } });
  await worker.start(run);
  await expect(worker.executeTask(run, "child", async (context) => {
    try { await context.withTemporarySession({ title: "child" }, async () => {}); } catch {}
    await expect(context.withTemporarySession({ title: "replacement" }, async () => {})).rejects.toThrow("poisoned");
    return "accepted";
  })).rejects.toThrow("poisoned");
  worker.complete(run);
  expect(worker.poisoned).toBe(true);
  expect(worker.idle).toBe(false);
  await expect(worker.executeTask({ ...run, runId: "next" }, "next", async () => {})).rejects.toThrow("poisoned");
  await worker.stop("cleanup retry");
  expect(aborted).toEqual(["child", "child"]);
  expect(removed).toEqual(["child"]);
});

test("stop during child creation fences the callback and cleans the late child", async () => {
  let created!: () => void;
  let ready!: () => void;
  const creating = new Promise<void>((resolve) => { ready = resolve; });
  const { worker, aborted, removed } = fixture({ create: async (owner) => {
    ready(); await new Promise<void>((resolve) => { created = resolve; });
    return { ...owner, sessionId: "child", parentSessionId: owner.sessionId };
  } });
  await worker.start(run);
  let callbacks = 0;
  const task = worker.executeTask(run, "child", (context) => context.withTemporarySession({ title: "child" }, async () => { callbacks++; }));
  await creating;
  const stopped = worker.stop("cancel");
  created();
  await stopped;
  await expect(task).rejects.toThrow();
  expect(callbacks).toBe(0);
  expect(aborted).toEqual(["parent", "child"]);
  expect(removed).toEqual(["child"]);
});

test("worker polling rejects output after exact run completion", async () => {
  const { worker } = fixture();
  await worker.start(run);
  await expect(worker.executeTask(run, "poll", (context) => context.poll(async () => {
    worker.complete(run);
    return { status: "complete", value: "late output" };
  }, { timeoutMs: 100, intervalMs: 1, maxAttempts: 2 }))).rejects.toThrow("no longer current");
});

test("a saved polling context cannot start reads for a replacement run", async () => {
  const { worker } = fixture();
  await worker.start(run);
  let old!: import("../src/index.js").OpenCodeTaskContext;
  await worker.executeTask(run, "save", async (context) => { old = context; });
  worker.complete(run);
  await worker.executeTask({ ...run, runId: "replacement" }, "next", async () => {});
  let reads = 0;
  expect(() => old.poll(async () => { reads++; return { status: "complete", value: "unsafe" }; }, { timeoutMs: 100, intervalMs: 1, maxAttempts: 2 })).toThrow("inactive");
  expect(reads).toBe(0);
});
