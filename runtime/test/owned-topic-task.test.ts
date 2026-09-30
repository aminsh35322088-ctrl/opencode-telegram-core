import { describe, expect, test } from "bun:test";
import path from "node:path";
import { OpenCodeTopicWorker, type BindingIdentity, type RunIdentity, type OpenCodeTaskContext } from "../src/index.js";

function binding(id = "a"): BindingIdentity {
  return { bindingId: id, botId: "bot", chatId: 1, threadId: id === "a" ? 2 : 3,
    sessionId: "session-" + id, normalizedDirectory: path.resolve("/workspace/" + id), bindingGeneration: 1 };
}

function workerFor(b = binding(), abortSession = async (_target: { sessionId: string; directory: string }, _signal: AbortSignal) => {}) {
  const worker = new OpenCodeTopicWorker(b, 1, null, {
    promptTimeoutMs: 1_000, cancellationGraceMs: 10, stopTimeoutMs: 30, abortSession,
  });
  const run: RunIdentity = { ...b, workerGeneration: 1, runId: "run-" + b.bindingId };
  return { worker, run };
}

describe("Core-owned Topic tasks", () => {
  test("acknowledged work retains its run and abort target until exact completion", async () => {
    const { worker, run } = workerFor();
    await worker.start(run);
    expect(await worker.executeTask(run, "admit", async () => "accepted")).toBe("accepted");
    expect(worker.idle).toBe(false);
    worker.complete({ ...run, runId: "old" });
    expect(worker.idle).toBe(false);
    worker.complete(run);
    expect(worker.idle).toBe(true);
  });

  test("rejects foreign leases and overlapping tasks before application code runs", async () => {
    const { worker, run } = workerFor();
    await worker.start(run);
    let calls = 0;
    await expect(worker.executeTask({ ...run, workerGeneration: 2 }, "foreign", async () => ++calls)).rejects.toThrow("lease");
    let finish!: () => void;
    const first = worker.executeTask(run, "first", () => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    await Promise.resolve();
    await expect(worker.executeTask(run, "second", async () => ++calls)).rejects.toThrow("active task");
    finish();
    await first;
    expect(calls).toBe(0);
    worker.complete(run);
  });

  test("stopping one Topic cancels only its temporary session and leaves another active", async () => {
    const aborted: string[] = [];
    const a = workerFor(binding("a"), async (target) => { aborted.push(target.sessionId); });
    const b = workerFor(binding("b"), async (target) => { aborted.push(target.sessionId); });
    await a.worker.start(a.run);
    await b.worker.start(b.run);
    await a.worker.executeTask(a.run, "temporary", async ({ setAbortTarget }) => {
      setAbortTarget({ sessionId: "temporary-a", directory: a.run.normalizedDirectory });
    }, { abortTarget: null });
    await b.worker.executeTask(b.run, "admit", async () => {});
    await a.worker.stop("rotate");
    expect(aborted).toEqual(["temporary-a"]);
    expect(b.worker.idle).toBe(false);
    b.worker.complete(b.run);
    await b.worker.stop("cleanup");
  });

  test("abort targets cannot escape the Topic workspace", async () => {
    const { worker, run } = workerFor();
    await worker.start(run);
    await expect(worker.executeTask(run, "escape", async ({ setAbortTarget }) => {
      setAbortTarget({ sessionId: "other", directory: binding("b").normalizedDirectory });
    })).rejects.toThrow("workspace");
    expect(worker.idle).toBe(true);
  });

  test("late task callbacks cannot mutate a completed or replacement run", async () => {
    const { worker, run } = workerFor();
    await worker.start(run);
    let old!: OpenCodeTaskContext;
    await worker.executeTask(run, "first", async (context) => { old = context; });
    worker.complete(run);
    const next = { ...run, runId: "next" };
    await worker.executeTask(next, "next", async () => {});
    expect(() => old.setAbortTarget(null)).toThrow("inactive");
    worker.complete(next);
  });

  test("completion cannot make an in-flight task idle or leak its late result", async () => {
    const { worker, run } = workerFor();
    await worker.start(run);
    let finish!: (result: string) => void;
    const pending = worker.executeTask(run, "slow", () => new Promise<string>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    await Promise.resolve();
    worker.complete(run);
    expect(worker.idle).toBe(false);
    finish("late");
    await expect(pending).rejects.toThrow("inactive");
    expect(worker.idle).toBe(true);
  });

  test("stop is bounded even when the remote abort ignores cancellation", async () => {
    let signal!: AbortSignal;
    const { worker, run } = workerFor(binding(), async (_target, abortSignal) => {
      signal = abortSignal;
      return await new Promise<void>(() => {});
    });
    await worker.start(run);
    await worker.executeTask(run, "admit", async () => {});
    await expect(worker.stop("delete")).rejects.toThrow("did not stop within");
    expect(signal.aborted).toBe(true);
  });

  test("stop cannot resurrect an old task or restart its worker instance", async () => {
    const { worker, run } = workerFor();
    await worker.start(run);
    await worker.stop("shutdown");
    await expect(worker.start(run)).rejects.toThrow("restart");
    await expect(worker.executeTask(run, "late", async () => "late")).rejects.toThrow("active");
  });

  test("a task deadline aborts its remote target before releasing its run", async () => {
    const aborted: string[] = [];
    const { worker, run } = workerFor(binding(), async (target) => { aborted.push(target.sessionId); });
    await worker.start(run);
    await expect(worker.executeTask(run, "deadline", ({ signal }) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), { timeoutMs: 10 })).rejects.toThrow("deadline");
    expect(aborted).toEqual([run.sessionId]);
    expect(worker.idle).toBe(true);
  });

  test("failed remote cleanup poisons the worker and retains its target for stopping", async () => {
    let aborts = 0;
    const { worker, run } = workerFor(binding(), async () => {
      if (++aborts === 1) throw new Error("transport unavailable");
    });
    await worker.start(run);
    await expect(worker.executeTask(run, "failed", async () => { throw new Error("task failed"); })).rejects.toThrow("cleanup failed");
    worker.complete(run);
    expect(worker.idle).toBe(false);
    expect(worker.poisoned).toBe(true);
    await expect(worker.executeTask({ ...run, runId: "next" }, "next", async () => {})).rejects.toThrow("poisoned");
    await worker.stop("cleanup retry");
    expect(aborts).toBe(2);
  });

  test("completion during admission retains the temporary abort target until stopping", async () => {
    const aborted: string[] = [];
    const { worker, run } = workerFor(binding(), async (target) => { aborted.push(target.sessionId); });
    await worker.start(run);
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const task = worker.executeTask(run, "admission", ({ signal, setAbortTarget }) => {
      setAbortTarget({ sessionId: "temporary", directory: run.normalizedDirectory });
      ready();
      return new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }, { abortTarget: null });
    await started;
    worker.complete(run);
    await worker.stop("rotate");
    await expect(task).rejects.toThrow();
    expect(aborted).toEqual(["temporary"]);
  });

  test("hung failure cleanup rejects further work instead of sharing its live session", async () => {
    const { worker, run } = workerFor(binding(), async () => await new Promise<void>(() => {}));
    await worker.start(run);
    await expect(worker.executeTask(run, "failure", async () => { throw new Error("failed"); })).rejects.toThrow("cleanup failed");
    expect(worker.idle).toBe(false);
    expect(worker.poisoned).toBe(true);
    await expect(worker.executeTask({ ...run, runId: "next" }, "next", async () => {})).rejects.toThrow("poisoned");
  });

  test("finishing during remote cleanup cannot make the worker eligible for idle eviction", async () => {
    let cleanup!: () => void;
    let ready!: () => void;
    const cleaning = new Promise<void>((resolve) => { ready = resolve; });
    const { worker, run } = workerFor(binding(), async () => {
      ready();
      await new Promise<void>((resolve) => { cleanup = resolve; });
    });
    await worker.start(run);
    const task = worker.executeTask(run, "failure", async () => { throw new Error("task failed"); });
    await cleaning;
    worker.complete(run);
    const idle = worker.idle;
    cleanup();
    await expect(task).rejects.toThrow("task failed");
    expect(idle).toBe(false);
    expect(worker.idle).toBe(true);
  });

  test("a prompt cannot overlap an owned task after early completion", async () => {
    const b = binding();
    const run: RunIdentity = { ...b, workerGeneration: 1, runId: "first" };
    const worker = new OpenCodeTopicWorker(b, 1, {
      prompt: async (sessionID) => ({ sessionID, id: "next", admittedSeq: 1, delivery: "queue", timeCreated: 1 }),
    }, { promptTimeoutMs: 1_000, cancellationGraceMs: 10, stopTimeoutMs: 30, abortSession: async () => {} });
    await worker.start(b);
    let finish!: () => void;
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const task = worker.executeTask(run, "slow", () => { ready(); return new Promise<void>((resolve) => { finish = resolve; }); });
    await started;
    worker.complete(run);
    let escaped: Promise<unknown> | undefined;
    let rejection: unknown;
    try { escaped = worker.executePrompt({ ...run, runId: "next" }, { text: "next" }); }
    catch (error) { rejection = error; }
    finish();
    await expect(task).rejects.toThrow("inactive");
    await escaped;
    expect(rejection).toBeInstanceOf(Error);
  });
});
