import { expect, test } from "bun:test";
import path from "node:path";
import { Api } from "grammy";
import { AuthoritativeRunReconciler, BindingRegistry, GrammyNativeMarkdownStreamPort, OpenCodeTopicWorker, OutboundGateway, PerRunStuckDetector, RunRegistry, RunLivenessTracker, SerialTaskQueue, TelegramRichStreamController, pollRunResult, withDeadline, type BindingIdentity } from "../src/index.js";

function binding(id = "one", threadId = 11): BindingIdentity {
  return { bindingId: id, botId: "bot", chatId: 10, threadId, sessionId: "session-" + id,
    normalizedDirectory: path.resolve("test-workspaces", id), bindingGeneration: 1 };
}

test("acknowledged runtime pause keeps run ownership but parks outbound until resume", async () => {
  const bindings = new BindingRegistry();
  const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  runs.observeExecution(run, { runId: run.runId, paused: true, continuation: "live" });
  let sends = 0;
  const gateway = new OutboundGateway(bindings, runs, { send: async () => { sends += 1; } });
  const pending = gateway.dispatch({ ...run, operationId: "send", kind: "text", payload: "held" });
  await Bun.sleep(20);
  const sendsWhilePaused = sends;
  const stillOwned = runs.accepts(run);
  runs.observeExecution(run, { runId: run.runId, paused: false, continuation: "live" });
  expect(await pending).toBe(true);
  expect(sendsWhilePaused).toBe(0);
  expect(stillOwned).toBe(true);
  expect(sends).toBe(1);
});

test("native result polling parks reads and its deadline during an acknowledged pause", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  const activity = runs.activity(run);
  let reads = 0;
  const pending = pollRunResult(run, async () => { reads += 1; return { status: "complete", value: "done" }; }, {
    signal: new AbortController().signal, timeoutMs: 20, intervalMs: 5, maxAttempts: 2,
    isCurrent: (owner) => runs.accepts(owner), activity, checkpoint: (signal: AbortSignal) => activity.checkpoint(signal),
  }).catch((error: unknown) => error);
  await Bun.sleep(50);
  const readsWhilePaused = reads;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe("done");
  expect(readsWhilePaused).toBe(0);
});

test("native queue task timeout freezes during acknowledged runtime pause", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  const queue = new SerialTaskQueue({ defaultTimeoutMs: 20, cancellationGraceMs: 10 });
  let release!: () => void;
  let settled = false;
  const pending = queue.enqueue("paused", async () => { await new Promise<void>((resolve) => { release = resolve; }); return "done"; }, 20, runs.activity(run))
    .finally(() => { settled = true; }).catch((error: unknown) => error);
  await Bun.sleep(50);
  const settledWhilePaused = settled;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  release();
  expect(await pending).toBe("done");
  expect(settledWhilePaused).toBe(false);
});

test("rotation while paused rejects held outbound and cannot adopt the replacement", async () => {
  const bindings = new BindingRegistry(); const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "old");
  runs.observeExecution(run, { runId: "old", paused: true, continuation: "live" });
  const activity = runs.activity(run);
  let sends = 0;
  const gateway = new OutboundGateway(bindings, runs, { send: async () => { sends += 1; } });
  const pending = gateway.dispatch({ ...run, operationId: "send", kind: "text", payload: "old" });
  const next = { ...owner, bindingGeneration: 2 };
  bindings.replace(next, 1); runs.fence(owner.bindingId);
  const replacement = runs.start(next, 2, "new");
  expect(await pending).toBe(false);
  expect(sends).toBe(0);
  expect(runs.observeExecution(run, { runId: "old", paused: false, continuation: "live" })).toBe(false);
  expect(runs.activity(replacement).paused).toBe(false);
  await expect(activity.checkpoint()).rejects.toThrow("stale runtime execution observation");
});

test("a paused Topic cannot block another Topic's delivery", async () => {
  const bindings = new BindingRegistry(); const runs = new RunRegistry();
  const a = binding("a", 11); const b = binding("b", 12);
  bindings.register(a); bindings.register(b);
  const first = runs.start(a, 1, "a"); const second = runs.start(b, 1, "b");
  runs.observeExecution(first, { runId: "a", paused: true, continuation: "live" });
  const sent: string[] = [];
  const gateway = new OutboundGateway(bindings, runs, { send: async (envelope) => { sent.push(envelope.runId); } });
  const held = gateway.dispatch({ ...first, operationId: "a", kind: "text", payload: "a" });
  expect(await gateway.dispatch({ ...second, operationId: "b", kind: "text", payload: "b" })).toBe(true);
  expect(sent).toEqual(["b"]);
  runs.fence(first.bindingId);
  expect(await held).toBe(false);
});

test("foreign or recovered runtime acknowledgments cannot report a live paused run", () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "current");
  expect(() => runs.observeExecution(run, { runId: "foreign", paused: true, continuation: "live" })).toThrow("stale or unavailable");
  expect(() => runs.observeExecution(run, { runId: "current", paused: true, continuation: "unavailable" })).toThrow("stale or unavailable");
  expect(runs.activity(run).paused).toBe(false);
});

test("acknowledged pause freezes native deadlines while fencing still cancels them", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  let settled = false;
  const pending = withDeadline(() => new Promise<never>(() => {}), { timeoutMs: 20, label: "held", activity: runs.activity(run) })
    .finally(() => { settled = true; }).catch((error: unknown) => error);
  await Bun.sleep(50);
  expect(settled).toBe(false);
  runs.fence(run.bindingId);
  expect(await pending).toBeInstanceOf(Error);
});

test("liveness counts active execution time rather than acknowledged pause duration", () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  const liveness = new RunLivenessTracker(runs); liveness.start(run, 100);
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }, 110);
  expect(liveness.assess(run, { now: 1000, stallAfterMs: 50, toolTimeoutMs: 50 })).toBe("healthy");
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" }, 1000);
  expect(liveness.assess(run, { now: 1030, stallAfterMs: 50, toolTimeoutMs: 50 })).toBe("healthy");
  expect(liveness.assess(run, { now: 1040, stallAfterMs: 50, toolTimeoutMs: 50 })).toBe("stalled");
});

test("worker polling and task budgets inherit the owned runtime pause", async () => {
  const runs = new RunRegistry(); const owner = binding(); const run = runs.start(owner, 1, "run");
  let aborts = 0;
  const worker = new OpenCodeTopicWorker(owner, 1, null, {
    promptTimeoutMs: 30, cancellationGraceMs: 10, stopTimeoutMs: 30,
    abortSession: async () => { aborts++; },
  });
  await worker.start(owner);
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  let reads = 0;
  let settled = false;
  const pending = worker.executeTask(run, "poll", (context) => context.poll(async () => {
    reads++; return { status: "complete", value: "same run" };
  }, { timeoutMs: 20, intervalMs: 5, maxAttempts: 2 }), { activity: runs.activity(run) })
    .finally(() => { settled = true; }).catch((error: unknown) => error);
  await Bun.sleep(60);
  const pausedState = { reads, settled, aborts };
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe("same run");
  expect(pausedState).toEqual({ reads: 0, settled: false, aborts: 0 });
  expect(worker.idle).toBe(false);
  worker.complete(run);
  await worker.stop("test cleanup");
});

test("queue never starts work whose runtime observation was already retired", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  const activity = runs.activity(run);
  runs.fence(run.bindingId);
  const queue = new SerialTaskQueue({ defaultTimeoutMs: 100, cancellationGraceMs: 10 });
  let starts = 0;
  await expect(queue.enqueue("retired", async () => { starts++; }, 100, activity)).rejects.toThrow();
  expect(starts).toBe(0);
});

test("fencing a paused uncooperative task quarantines its queue", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  const queue = new SerialTaskQueue({ defaultTimeoutMs: 100, cancellationGraceMs: 10 });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const pending = queue.enqueue("ignores abort", async () => { started(); return new Promise<void>(() => {}); }, 100, runs.activity(run))
    .catch((error: unknown) => error);
  await ready;
  runs.fence(run.bindingId);
  expect(await pending).toMatchObject({ name: "QueuePoisonedError" });
  let starts = 0;
  await expect(queue.enqueue("replacement", async () => { starts++; })).rejects.toThrow("isolation boundary");
  expect(starts).toBe(0);
});

test("paused rich drafts retain their lease and finalize only after resume", async () => {
  const bindings = new BindingRegistry(); const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  const mutations: string[] = [];
  const rich = new TelegramRichStreamController(bindings, runs, {
    sendDraft: async (_route, _id, message) => { mutations.push("draft:" + message.markdown); },
    sendFinal: async (_route, message) => { mutations.push("final:" + message.markdown); },
  }, async () => { throw new Error("pause must not abort"); });
  const route = { chatId: 10, messageThreadId: 11 };
  const draft = await rich.startMarkdown(run, route, "first");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  const pending = rich.finalizeMarkdown(run, route, draft!, "finished");
  await Bun.sleep(20);
  const whilePaused = [...mutations];
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe(true);
  expect(whilePaused).toEqual(["draft:first"]);
  expect(mutations).toEqual(["draft:first", "final:finished"]);
});

test("rotation rejects a rich mutation waiting at its pause checkpoint", async () => {
  const bindings = new BindingRegistry(); const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  let sends = 0;
  const rich = new TelegramRichStreamController(bindings, runs, {
    sendDraft: async () => { sends++; }, sendFinal: async () => { sends++; },
  }, async () => {});
  const route = { chatId: 10, messageThreadId: 11 };
  const draft = await rich.startMarkdown(run, route, "first");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  const pending = rich.updateMarkdown(run, route, draft!, "late");
  await Bun.sleep(5);
  bindings.replace({ ...owner, bindingGeneration: 2 }, 1); runs.fence(run.bindingId);
  expect(await pending).toBe(false);
  expect(sends).toBe(1);
});

test("grammY stream pauses at the actual Telegram transport boundary", async () => {
  const bindings = new BindingRegistry(); const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  const api = new Api("123:test");
  const mutations: string[] = [];
  api.config.use(async (_previous, method) => {
    mutations.push(method);
    return { ok: true, result: method === "sendRichMessageDraft" ? true : {
      message_id: 1, date: 1, chat: { id: 10, type: "supergroup", title: "Test" }, rich_message: { markdown: "answer" },
    } } as never;
  });
  const rich = new TelegramRichStreamController(bindings, runs, { sendDraft: async () => {}, sendFinal: async () => {} }, async () => {});
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  const pending = rich.streamMarkdown(run, { chatId: 10, messageThreadId: 11 }, ["answer"], new GrammyNativeMarkdownStreamPort(api));
  await Bun.sleep(20);
  const whilePaused = mutations.length;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe(true);
  expect(whilePaused).toBe(0);
  expect(mutations).toContain("sendRichMessage");
  rich.releaseRun(run);
});

test("paused execution cannot trigger liveness or duplicate-tool abort decisions", () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  const liveness = new RunLivenessTracker(runs); liveness.start(run, 0);
  const stuck = new PerRunStuckDetector(runs, 2);
  expect(stuck.observeTool(run, "read", { file: "same" })).toBe("ok");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }, 100);
  expect(liveness.assess(run, { now: 1000, stallAfterMs: 50, toolTimeoutMs: 50 })).toBe("healthy");
  expect(stuck.observeTool(run, "read", { file: "same" })).toBe("ok");
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" }, 1000);
  expect(stuck.observeTool(run, "read", { file: "same" })).toBe("stuck");
});

test("reconciliation cannot finalize or interrupt an acknowledged paused run", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }, 100);
  let requests = 0; let interrupts = 0;
  const reconciler = new AuthoritativeRunReconciler(runs, {
    status: async () => { requests++; return "idle"; }, interrupt: async () => { interrupts++; },
  }, { requestTimeoutMs: 100, providerRetryCeilingMs: 50, now: () => 1000 });
  expect(await reconciler.probe(run, 0)).toBe("active");
  expect(runs.accepts(run)).toBe(true);
  expect(requests).toBe(0); expect(interrupts).toBe(0);
});

test("a probe admitted before pause cannot finalize the paused owner with late idle", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  let complete!: (status: "idle") => void;
  const reconciler = new AuthoritativeRunReconciler(runs, {
    status: async () => new Promise((resolve) => { complete = resolve; }), interrupt: async () => {},
  }, { requestTimeoutMs: 100, providerRetryCeilingMs: 50 });
  const pending = reconciler.probe(run, 0);
  await Bun.sleep(1);
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  complete("idle");
  expect(await pending).toBe("active");
  expect(runs.accepts(run)).toBe(true);
});

test("provider retry ceiling counts execution time excluding pause", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }, 100);
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" }, 900);
  let now = 990; let interrupts = 0;
  const reconciler = new AuthoritativeRunReconciler(runs, {
    status: async () => "retry", interrupt: async () => { interrupts++; },
  }, { requestTimeoutMs: 100, providerRetryCeilingMs: 200, now: () => now });
  expect(await reconciler.probe(run, 0)).toBe("active");
  expect(interrupts).toBe(0);
  now = 1000;
  expect(await reconciler.probe(run, 0)).toBe("aborted_retry_ceiling");
  expect(interrupts).toBe(1);
});

test("paused temporary task preserves its session until result delivery can resume", async () => {
  const owner = binding(); const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  const cleanup: string[] = [];
  const worker = new OpenCodeTopicWorker(owner, 1, null, {
    promptTimeoutMs: 300, cancellationGraceMs: 10, stopTimeoutMs: 100,
    abortSession: async (target) => { cleanup.push("worker:" + target.sessionId); },
    temporarySessionPort: {
      get: async () => ({ sessionId: owner.sessionId, directory: owner.normalizedDirectory }),
      create: async () => ({ sessionId: "temporary", directory: owner.normalizedDirectory, parentSessionId: owner.sessionId }),
      abort: async (target) => { cleanup.push("abort:" + target.sessionId); },
      remove: async (target) => { cleanup.push("remove:" + target.sessionId); },
    },
  });
  await worker.start(owner);
  let started!: () => void; let finish!: (result: string) => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const pending = worker.executeTask(run, "temporary", ({ withTemporarySession }) =>
    withTemporarySession({ title: "diagnostic" }, async () => {
      started(); return new Promise<string>((resolve) => { finish = resolve; });
    }), { activity: runs.activity(run) });
  await ready;
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  finish("result");
  await Bun.sleep(20);
  const whilePaused = [...cleanup];
  const targetWhilePaused = worker.executionTarget(run)?.sessionId;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe("result");
  expect(whilePaused).toEqual([]);
  expect(targetWhilePaused).toBe("temporary");
  expect(cleanup).toEqual(["abort:temporary", "remove:temporary"]);
  worker.complete(run); await worker.stop("test cleanup");
});

test("rich delivery cannot mutate after a fence racing readiness", async () => {
  const bindings = new BindingRegistry(); const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  let sends = 0;
  let staleSends = 0;
  const rich = new TelegramRichStreamController(bindings, runs, {
    sendDraft: async () => { sends++; if (!runs.accepts(run)) staleSends++; }, sendFinal: async () => { sends++; },
  }, async () => {});
  const route = { chatId: 10, messageThreadId: 11 };
  const draft = await rich.startMarkdown(run, route, "first");
  runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" });
  const pending = rich.updateMarkdown(run, route, draft!, "late");
  await Bun.sleep(1);
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  queueMicrotask(() => queueMicrotask(() => { bindings.fence(owner.bindingId); runs.fence(owner.bindingId); }));
  await pending;
  expect(staleSends).toBe(0);
  expect(sends).toBeLessThanOrEqual(2);
});

test("pause racing rich readiness still holds the actual send without losing its draft", async () => {
  const bindings = new BindingRegistry(); const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  let sends = 0;
  const rich = new TelegramRichStreamController(bindings, runs, {
    sendDraft: async () => { sends++; }, sendFinal: async () => { sends++; },
  }, async () => {});
  queueMicrotask(() => runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }));
  const pending = rich.startMarkdown(run, { chatId: 10, messageThreadId: 11 }, "held");
  await Bun.sleep(5);
  const whilePaused = sends;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).not.toBeNull();
  expect(whilePaused).toBe(0);
  expect(sends).toBe(1);
  rich.releaseRun(run);
});

test("outbound pause racing its checkpoint holds transport admission", async () => {
  const bindings = new BindingRegistry(); const owner = binding(); bindings.register(owner);
  const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  let sends = 0;
  const gateway = new OutboundGateway(bindings, runs, { send: async () => { sends++; } });
  queueMicrotask(() => runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }));
  const pending = gateway.dispatch({ ...run, operationId: "held", kind: "text", payload: "held" });
  await Bun.sleep(5);
  const whilePaused = sends;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe(true);
  expect(whilePaused).toBe(0);
  expect(sends).toBe(1);
});

test("a failing native observer cannot leave earlier deadlines parked as healthy", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  const activity = runs.activity(run);
  let settled = false;
  const pending = withDeadline(() => new Promise<void>(() => {}), { timeoutMs: 100, label: "observer", activity })
    .finally(() => { settled = true; }).catch((error: unknown) => error);
  activity.subscribe(() => { throw new Error("observer failed"); });
  let observedError: unknown;
  try { runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }); }
  catch (error) { observedError = error; }
  await Bun.sleep(5);
  const settledBeforeFence = settled;
  runs.fence(run.bindingId);
  expect(await pending).toBeInstanceOf(Error);
  expect(observedError).toBeInstanceOf(Error);
  expect(settledBeforeFence).toBe(true);
  await expect(activity.checkpoint()).rejects.toThrow();
});

test("pause racing a worker's checkpoint cannot admit application work", async () => {
  const owner = binding(); const runs = new RunRegistry(); const run = runs.start(owner, 1, "run");
  const worker = new OpenCodeTopicWorker(owner, 1, null, {
    promptTimeoutMs: 200, cancellationGraceMs: 10, stopTimeoutMs: 50, abortSession: async () => {},
  });
  await worker.start(owner);
  let admitted = false;
  const pending = worker.executeTask(run, "admit", async () => { admitted = true; return "done"; }, { activity: runs.activity(run) });
  queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }))));
  await Bun.sleep(5);
  const whilePaused = admitted;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe("done");
  expect(whilePaused).toBe(false);
  worker.complete(run); await worker.stop("test cleanup");
});

test("polling rechecks a pause arriving as its checkpoint resolves", async () => {
  const runs = new RunRegistry(); const run = runs.start(binding(), 1, "run");
  const activity = runs.activity(run);
  let queued = false; let reads = 0;
  const pending = pollRunResult(run, async () => { reads++; return { status: "complete", value: "done" }; }, {
    signal: new AbortController().signal, timeoutMs: 100, intervalMs: 5, maxAttempts: 2,
    isCurrent: (owner) => runs.accepts(owner), activity,
    checkpoint: async (signal) => {
      await activity.checkpoint(signal);
      if (!queued) {
        queued = true;
        queueMicrotask(() => runs.observeExecution(run, { runId: "run", paused: true, continuation: "live" }));
      }
    },
  });
  await Bun.sleep(5);
  const whilePaused = reads;
  runs.observeExecution(run, { runId: "run", paused: false, continuation: "live" });
  expect(await pending).toBe("done");
  expect(whilePaused).toBe(0);
});
