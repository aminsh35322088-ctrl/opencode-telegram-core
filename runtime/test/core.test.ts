import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  TelegramNativeCore,
  type BindingIdentity,
  type InputRichMessageWithoutUpload,
  type RichDraftRoute,
  type RichMessagePort,
  type TopicWorker,
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

  async function open() {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-core-"));
    const workers = new Map<string, FakeWorker>();
    const aborted: string[] = [];
    const core = await TelegramNativeCore.open({
      bindingStorePath: path.join(root, "bindings.json"),
      workerFactory: (b, generation) => {
        const worker = new FakeWorker(b.bindingId, generation);
        workers.set(b.bindingId, worker);
        return worker;
      },
      outboundSink: { send: async () => undefined },
      richMessagePort: new FakeRichPort(),
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
