import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BindingRegistry,
  OutboundGateway,
  QueuePoisonedError,
  RunRegistry,
  SerialTaskQueue,
  TelegramApiBudgetClient,
  WorkerSupervisor,
  assertWorkspacePath,
  completed,
  type BindingIdentity,
  type OutboundEnvelope,
  type TopicWorker,
} from "../src/index.js";

function binding(overrides: Partial<BindingIdentity> = {}): BindingIdentity {
  return {
    bindingId: "binding-a",
    botId: "bot-main",
    chatId: 100,
    threadId: 11,
    sessionId: "session-a",
    normalizedDirectory: "/workspace/a",
    bindingGeneration: 1,
    ...overrides,
  };
}

describe("identity fencing", () => {
  test("late run output is dropped after replacement run starts", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const b = binding();
    bindings.register(b);
    const oldRun = runs.start(b, 1, "run-old");
    runs.start(b, 1, "run-new");
    const sent: OutboundEnvelope[] = [];
    const gateway = new OutboundGateway(bindings, runs, { send: async (e) => { sent.push(e); } });

    const accepted = await gateway.dispatch({
      ...oldRun,
      operationId: "old-op",
      kind: "stream.delta",
      payload: { text: "stale" },
    });

    expect(accepted).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("old binding generation is fenced before outbound", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const b = binding();
    bindings.register(b);
    const run = runs.start(b, 1, "run-a");
    bindings.fence(b.bindingId);
    const gateway = new OutboundGateway(bindings, runs, { send: async () => { throw new Error("must not send"); } });

    expect(await gateway.dispatch({
      ...run,
      operationId: "stale-generation",
      kind: "telegram.edit",
      payload: {},
    })).toBe(false);
  });
});

describe("poison-resistant serial queue", () => {
  test("aborted task that cooperates cannot poison later work", async () => {
    const queue = new SerialTaskQueue({ defaultTimeoutMs: 10, cancellationGraceMs: 50 });
    const first = queue.enqueue("cooperative", (signal) => new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }));
    await expect(first).rejects.toThrow("deadline");
    expect(await queue.enqueue("next", async () => 42)).toBe(42);
    expect(queue.poisoned).toBe(false);
  });

  test("uncooperative timed-out task poisons queue instead of running next task concurrently", async () => {
    let nextRan = false;
    let release!: () => void;
    const queue = new SerialTaskQueue({ defaultTimeoutMs: 10, cancellationGraceMs: 10 });
    const first = queue.enqueue("wedged", () => new Promise<void>((resolve) => { release = resolve; }));

    await expect(first).rejects.toBeInstanceOf(QueuePoisonedError);
    await expect(queue.enqueue("next", async () => { nextRan = true; })).rejects.toBeInstanceOf(QueuePoisonedError);
    expect(nextRan).toBe(false);
    release();
  });
});

describe("terminal state", () => {
  test("empty assistant completion is explicit, never silent", () => {
    expect(completed("").reason).toBe("COMPLETED_EMPTY");
    expect(completed("ok").reason).toBe("COMPLETED");
  });
});

describe("Telegram request budgets", () => {
  test("regular API calls get an aborting deadline while getUpdates remains long-poll capable", async () => {
    let normalAborted = false;
    const transport = {
      call: async <T>(method: string, _payload: unknown, signal?: AbortSignal): Promise<T> => {
        if (method === "getUpdates") return "poll-ok" as T;
        return await new Promise<T>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            normalAborted = true;
            reject(signal.reason);
          }, { once: true });
        });
      },
    };
    const client = new TelegramApiBudgetClient(transport, {
      requestTimeoutMs: 10,
      maxRetryAfterMs: 20,
      maxElapsedMs: 100,
      maxRetries: 1,
    });

    await expect(client.call("sendMessage", {})).rejects.toThrow("deadline");
    expect(normalAborted).toBe(true);
    expect(await client.call<string>("getUpdates", {})).toBe("poll-ok");
  });
});

describe("Railway-bounded worker supervisor", () => {
  test("evicts only an idle worker and does not disturb active binding", async () => {
    const stopped: string[] = [];
    class FakeWorker implements TopicWorker {
      idle = false;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> { stopped.push(this.bindingId); }
    }
    const workers = new Map<string, FakeWorker>();
    const supervisor = new WorkerSupervisor((b, g) => {
      const worker = new FakeWorker(b.bindingId, g);
      workers.set(b.bindingId, worker);
      return worker;
    }, { maxWorkers: 2 });

    await supervisor.ensure(binding({ bindingId: "a", threadId: 1 }));
    await supervisor.ensure(binding({ bindingId: "b", threadId: 2 }));
    workers.get("a")!.idle = true;
    await supervisor.ensure(binding({ bindingId: "c", threadId: 3 }));

    expect(stopped).toEqual(["a"]);
    expect(supervisor.size()).toBe(2);
  });

  test("crash replacement is scoped to one binding and increments worker generation", async () => {
    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const supervisor = new WorkerSupervisor((b, g) => new FakeWorker(b.bindingId, g), { maxWorkers: 3 });
    const a = binding({ bindingId: "a", threadId: 1 });
    const b = binding({ bindingId: "b", threadId: 2 });
    const a1 = await supervisor.ensure(a);
    const b1 = await supervisor.ensure(b);
    const a2 = await supervisor.workerCrashed(a);

    expect(a2.generation).toBe(a1.generation + 1);
    expect((await supervisor.ensure(b)).generation).toBe(b1.generation);
  });

  test("concurrent ensure of one binding builds exactly one worker and never leaks a slot", async () => {
    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const created: FakeWorker[] = [];
    const supervisor = new WorkerSupervisor((b, g) => {
      const worker = new FakeWorker(b.bindingId, g);
      created.push(worker);
      return worker;
    }, { maxWorkers: 3 });
    const a = binding({ bindingId: "a", threadId: 1 });

    const [first, second] = await Promise.all([supervisor.ensure(a), supervisor.ensure(a)]);

    expect(created).toHaveLength(1);
    expect(first).toBe(second);
    expect(supervisor.size()).toBe(1);
  });
});

describe("workspace isolation", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  test("symlink escape into another topic is rejected", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "otc-workspace-"));
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    await mkdir(a);
    await mkdir(b);
    await writeFile(path.join(b, "secret.txt"), "secret");
    await symlink(b, path.join(a, "other"));

    await expect(assertWorkspacePath(a, "other/secret.txt")).rejects.toThrow("escapes workspace");
    expect(await assertWorkspacePath(b, "secret.txt")).toBe(path.join(b, "secret.txt"));
  });
});
