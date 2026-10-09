import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InputRichMessageWithoutUpload } from "grammy/types";
import {
  TelegramNativeCore,
  type BindingIdentity,
  type NativeMarkdownStreamPort,
  type RichDraftRoute,
  type RichMessagePort,
  type TopicWorker,
  type WorkerFactory,
  OpenCodeTopicWorker,
} from "../src/index.js";

function binding(id: string, threadId: number): BindingIdentity {
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

class FakeWorker implements TopicWorker {
  idle = false;
  stopped = false;
  constructor(readonly bindingId: string, readonly generation: number) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> { this.stopped = true; }
  complete(): void { this.idle = true; }
}

class FakeNativeStreamPort implements NativeMarkdownStreamPort {
  async streamMarkdown(
    _route: RichDraftRoute,
    _draftId: number,
    chunks: AsyncIterable<string> | Iterable<string>,
    options: { readonly signal: AbortSignal; readonly guard: () => boolean },
  ): Promise<void> {
    for await (const _chunk of chunks) {
      options.signal.throwIfAborted();
      if (!options.guard()) throw new Error("fenced");
    }
  }
}

class FakeRichPort implements RichMessagePort {
  async sendDraft(
    _route: RichDraftRoute,
    _draftId: number,
    _richMessage: InputRichMessageWithoutUpload,
  ): Promise<void> {}
  async sendFinal(
    _route: RichDraftRoute,
    _richMessage: InputRichMessageWithoutUpload,
  ): Promise<void> {}
}

describe("TelegramNativeCore composition", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function open(factory?: WorkerFactory) {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-core-"));
    const workers = new Map<string, FakeWorker>();
    const aborted: string[] = [];
    const core = await TelegramNativeCore.open({
      bindingStorePath: path.join(root, "bindings.json"),
      workerFactory: (b, generation) => {
        if (factory) return factory(b, generation);
        const worker = new FakeWorker(b.bindingId, generation);
        workers.set(b.bindingId, worker);
        return worker;
      },
      outboundSink: { send: async () => undefined },
      richMessagePort: new FakeRichPort(),
      nativeMarkdownStreamPort: new FakeNativeStreamPort(),
      abortRun: async (run) => { aborted.push(run.runId); },
      admissionPolicy: ({ operation }) =>
        operation === "model.prompt" ? "MODEL_ALLOWED" : "CONTROL_ONLY",
      railwayPolicy: {
        softRssBytes: Number.MAX_SAFE_INTEGER - 1,
        hardRssBytes: Number.MAX_SAFE_INTEGER,
        maxWorkers: 8,
        maxRestartsPerBinding: 3,
        restartWindowMs: 60_000,
      },
    });
    return { core, workers, aborted };
  }

  test("rotate fences only target binding and persists next generation before replacement", async () => {
    const { core, workers } = await open();
    await core.registerBinding(binding("a", 11));
    await core.registerBinding(binding("b", 22));
    const runA = await core.beginRun("a", "run-a");
    const runB = await core.beginRun("b", "run-b");

    const replacement = await core.rotateBinding("a", {
      sessionId: "session-a-2",
      normalizedDirectory: "/workspace/a2",
    });

    expect(replacement.bindingGeneration).toBe(2);
    expect(core.runs.current("a")).toBeNull();
    expect(core.runs.current("b")?.runId).toBe(runB.runId);
    expect(workers.get("a")?.stopped).toBe(true);
    expect(workers.get("b")?.stopped).toBe(false);
    expect(runA.bindingGeneration).toBe(1);

    const reopened = await TelegramNativeCore.open({
      bindingStorePath: path.join(root!, "bindings.json"),
      workerFactory: (b, generation) => new FakeWorker(b.bindingId, generation),
      outboundSink: { send: async () => undefined },
      richMessagePort: new FakeRichPort(),
      nativeMarkdownStreamPort: new FakeNativeStreamPort(),
      abortRun: async () => undefined,
      admissionPolicy: () => "MODEL_ALLOWED",
      railwayPolicy: {
        softRssBytes: Number.MAX_SAFE_INTEGER - 1,
        hardRssBytes: Number.MAX_SAFE_INTEGER,
        maxWorkers: 8,
        maxRestartsPerBinding: 3,
        restartWindowMs: 60_000,
      },
    });
    expect(reopened.bindings.registry.getById("a")?.bindingGeneration).toBe(2);
  });

  test("Telegram Stop fences run before interrupt callback completes", async () => {
    const { core, aborted } = await open();
    await core.registerBinding(binding("a", 11));
    const run = await core.beginRun("a", "stop-me");
    const route = { chatId: 100, messageThreadId: 11 };
    const draftId = await core.rich.startMarkdown(run, route, "working");

    expect(await core.handleGenerationStopped({
      chat: { id: 100 },
      message_thread_id: 11,
      draft_id: draftId!,
    })).toBe(true);
    expect(core.runs.current("a")).toBeNull();
    expect(aborted).toEqual(["stop-me"]);
  });

  test("finishRun releases rich draft leases owned by the run", async () => {
    const { core } = await open();
    await core.registerBinding(binding("a", 11));
    const run = await core.beginRun("a", "finish-cleans-draft");
    const route = { chatId: 100, messageThreadId: 11 };
    const draftId = await core.rich.startMarkdown(run, route, "working");
    expect(draftId).not.toBeNull();

    expect(core.finishRun(run)).toBe(true);
    expect(core.rich.releaseDraft(run, route, draftId!)).toBe(false);
  });

  test("finishRun completes only the current worker lease", async () => {
    const { core } = await open();
    const b = { ...binding("a", 11), normalizedDirectory: path.resolve("/workspace/a") };
    core.bindings.registry.register(b);
    const first = await core.beginRun("a", "first");
    expect(core.finishRun({ ...first, runId: "foreign" })).toBe(false);
    expect(core.workers.idleCount()).toBe(0);
    expect(core.finishRun(first)).toBe(true);
    expect(core.workers.idleCount()).toBe(1);
    await core.shutdown();
  });

  test("owned task dispatch rechecks admission after acquiring its worker", async () => {
    const { core } = await open((b, generation) => new OpenCodeTopicWorker(b, generation, null, {
      promptTimeoutMs: 1_000, cancellationGraceMs: 10, stopTimeoutMs: 50,
    }));
    core.bindings.registry.register({ ...binding("a", 11), normalizedDirectory: path.resolve("/workspace/a") });
    const first = await core.beginRun("a", "first");
    let calls = 0;
    const dispatched = core.dispatchTask(first, "late", async () => ++calls, { abortTarget: null });
    core.finishRun(first);
    await expect(dispatched).rejects.toThrow("fenced");
    expect(calls).toBe(0);
    const next = await core.beginRun("a", "next");
    expect(await core.dispatchTask(next, "current", async () => ++calls, { abortTarget: null })).toBe(1);
    core.finishRun(next);
    await core.shutdown();
  });

  test("Telegram Stop clears the run's liveness and stuck bookkeeping", async () => {
    const { core } = await open();
    await core.registerBinding(binding("a", 11));
    const run = await core.beginRun("a", "stop-cleanup");
    const route = { chatId: 100, messageThreadId: 11 };
    const draftId = await core.rich.startMarkdown(run, route, "working");
    expect(core.liveness.touch(run)).toBe(true);
    expect(core.stuck.observeTool(run, "bash", { command: "ls" })).toBe("ok");

    expect(await core.handleGenerationStopped({
      chat: { id: 100 },
      message_thread_id: 11,
      draft_id: draftId!,
    })).toBe(true);

    // finishRun() must run on this path, not the bare registry, otherwise the
    // per-run bookkeeping survives a completed run.
    expect(core.liveness.touch(run)).toBe(false);
    expect(core.stuck.observeTool(run, "bash", { command: "ls" })).toBe("stale");
  });

  test("rotate during worker start cannot admit a stale run", async () => {
    let signalStarted!: () => void;
    let releaseStart!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });

    class DelayedWorker implements TopicWorker {
      idle = false;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {
        signalStarted();
        await startGate;
      }
      async stop(): Promise<void> {}
    }

    root = await mkdtemp(path.join(os.tmpdir(), "otc-core-"));
    const core = await TelegramNativeCore.open({
      bindingStorePath: path.join(root, "bindings.json"),
      workerFactory: (b, generation) => new DelayedWorker(b.bindingId, generation),
      outboundSink: { send: async () => undefined },
      richMessagePort: new FakeRichPort(),
      nativeMarkdownStreamPort: new FakeNativeStreamPort(),
      abortRun: async () => undefined,
      admissionPolicy: () => "MODEL_ALLOWED",
      railwayPolicy: {
        softRssBytes: Number.MAX_SAFE_INTEGER - 1,
        hardRssBytes: Number.MAX_SAFE_INTEGER,
        maxWorkers: 2,
        maxRestartsPerBinding: 3,
        restartWindowMs: 60_000,
      },
    });
    await core.registerBinding(binding("a", 11));

    const beginning = core.beginRun("a", "stale-run");
    await started;
    let signalReplacement!: () => void;
    const replacementPersisted = new Promise<void>((resolve) => { signalReplacement = resolve; });
    const replace = core.bindings.replace.bind(core.bindings);
    core.bindings.replace = async (...args: Parameters<typeof replace>) => {
      await replace(...args);
      signalReplacement();
    };
    const rotating = core.rotateBinding("a", {
      sessionId: "session-a-2",
      normalizedDirectory: "/workspace/a2",
    });

    // Synchronize on the actual durable fencing point, not filesystem timing.
    await replacementPersisted;
    expect(core.bindings.registry.getById("a")?.bindingGeneration).toBe(2);
    releaseStart();

    const [beginResult, rotateResult] = await Promise.allSettled([beginning, rotating]);
    expect(rotateResult.status).toBe("fulfilled");
    expect(beginResult.status).toBe("rejected");
    expect(core.runs.current("a")).toBeNull();
  });

  test("reopen reconciles an incomplete delete without exposing the route", async () => {
    const { core } = await open();
    await core.registerBinding(binding("a", 11));
    await core.bindings.beginDelete("a");

    const cleanup: string[] = [];
    const reopened = await TelegramNativeCore.open({
      bindingStorePath: path.join(root!, "bindings.json"),
      workerFactory: (b, generation) => new FakeWorker(b.bindingId, generation),
      outboundSink: { send: async () => undefined },
      richMessagePort: new FakeRichPort(),
      nativeMarkdownStreamPort: new FakeNativeStreamPort(),
      abortRun: async () => undefined,
      cleanupBinding: async (target) => { cleanup.push(target.bindingId); },
      admissionPolicy: () => "MODEL_ALLOWED",
      railwayPolicy: {
        softRssBytes: Number.MAX_SAFE_INTEGER - 1,
        hardRssBytes: Number.MAX_SAFE_INTEGER,
        maxWorkers: 8,
        maxRestartsPerBinding: 3,
        restartWindowMs: 60_000,
      },
    });

    expect(reopened.bindings.registry.getById("a")).toBeNull();
    expect(reopened.bindings.pendingDeletes()).toHaveLength(0);
    expect(cleanup).toEqual(["a"]);
  });

  test("shutdown stops all workers without cross-binding mutation", async () => {
    const { core, workers } = await open();
    await core.registerBinding(binding("a", 11));
    await core.registerBinding(binding("b", 22));
    await core.beginRun("a", "a");
    await core.beginRun("b", "b");

    await core.shutdown();

    expect(core.runs.current("a")).toBeNull();
    expect(core.runs.current("b")).toBeNull();
    expect(workers.get("a")?.stopped).toBe(true);
    expect(workers.get("b")?.stopped).toBe(true);
  });
});
