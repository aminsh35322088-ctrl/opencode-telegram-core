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
    const a2 = await supervisor.workerCrashed(a, a1.generation);

    expect(a2.generation).toBe(a1.generation + 1);
    expect((await supervisor.ensure(b)).generation).toBe(b1.generation);
  });

  test("late crash from a retired generation cannot replace the current worker", async () => {
    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 2 },
    );
    const firstBinding = binding({ bindingId: "a", threadId: 1 });
    const first = await supervisor.ensure(firstBinding);
    await supervisor.stop("a", "binding_rotated");

    const replacementBinding = {
      ...firstBinding,
      sessionId: "session-a-next",
      normalizedDirectory: "/workspace/a-next",
      bindingGeneration: firstBinding.bindingGeneration + 1,
    };
    const replacement = await supervisor.ensure(replacementBinding);

    await expect(
      supervisor.workerCrashed(firstBinding, first.generation),
    ).rejects.toThrow("stale worker crash");
    expect(supervisor.isCurrent(replacementBinding, replacement)).toBe(true);
    expect(first.generation).not.toBe(replacement.generation);
  });

  test("duplicate crash from an old worker generation cannot kill its replacement", async () => {
    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 2 },
    );
    const a = binding({ bindingId: "a", threadId: 1 });

    const first = await supervisor.ensure(a);
    const replacement = await supervisor.workerCrashed(a, first.generation);

    await expect(
      supervisor.workerCrashed(a, first.generation),
    ).rejects.toThrow("stale worker crash");
    expect(supervisor.isCurrent(a, replacement)).toBe(true);
  });

  test("intentional stop supersedes an in-flight crash recovery", async () => {
    let signalRetiring!: () => void;
    let releaseRetirement!: () => void;
    const retiring = new Promise<void>((resolve) => { signalRetiring = resolve; });
    const retirementGate = new Promise<void>((resolve) => { releaseRetirement = resolve; });

    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {
        signalRetiring();
        await retirementGate;
      }
    }
    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 1 },
    );
    const a = binding({ bindingId: "a", threadId: 1 });
    const first = await supervisor.ensure(a);

    const recovery = supervisor.workerCrashed(a, first.generation);
    const recoveryResult = recovery.then(
      () => "fulfilled" as const,
      () => "rejected" as const,
    );
    await retiring;

    const stopping = supervisor.stop("a", "binding_rotated");
    releaseRetirement();
    await stopping;

    expect(await recoveryResult).toBe("rejected");
    expect(supervisor.size()).toBe(0);
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

  test("a slow start in one binding does not block another binding", async () => {
    let signalAStarted!: () => void;
    let releaseA!: () => void;
    const aStarted = new Promise<void>((resolve) => { signalAStarted = resolve; });
    const aGate = new Promise<void>((resolve) => { releaseA = resolve; });
    let bStarted = false;

    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {
        if (this.bindingId === "a") {
          signalAStarted();
          await aGate;
        } else {
          bStarted = true;
        }
      }
      async stop(): Promise<void> {}
    }

    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 2 },
    );

    const a = supervisor.ensure(binding({ bindingId: "a", threadId: 1 }));
    await aStarted;
    const b = supervisor.ensure(binding({ bindingId: "b", threadId: 2 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(bStarted).toBe(true);
    releaseA();
    await Promise.all([a, b]);
    expect(supervisor.size()).toBe(2);
  });

  test("failed start releases its reserved capacity", async () => {
    let failFirst = true;

    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {
        if (failFirst) {
          failFirst = false;
          throw new Error("boom");
        }
      }
      async stop(): Promise<void> {}
    }

    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 1 },
    );

    await expect(
      supervisor.ensure(binding({ bindingId: "a", threadId: 1 })),
    ).rejects.toThrow("boom");
    expect(supervisor.size()).toBe(0);

    const b = await supervisor.ensure(binding({ bindingId: "b", threadId: 2 }));
    expect(b.bindingId).toBe("b");
    expect(supervisor.size()).toBe(1);
  });

  test("concurrent distinct ensures never exceed maxWorkers", async () => {
    let releaseAStop!: () => void;
    const aStopGate = new Promise<void>((resolve) => { releaseAStop = resolve; });

    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {
        if (this.bindingId === "a") await aStopGate;
      }
    }

    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 1 },
    );
    await supervisor.ensure(binding({ bindingId: "a", threadId: 1 }));

    const b = supervisor.ensure(binding({ bindingId: "b", threadId: 2 }));
    const c = supervisor.ensure(binding({ bindingId: "c", threadId: 3 }));
    await Promise.resolve();
    releaseAStop();
    await Promise.allSettled([b, c]);

    expect(supervisor.size()).toBeLessThanOrEqual(1);
  });

  test("retiring worker keeps capacity until stop resolves", async () => {
    let alive = 0;
    let maxAlive = 0;
    let signalStopEntered!: () => void;
    let releaseStop!: () => void;
    const stopEntered = new Promise<void>((resolve) => {
      signalStopEntered = resolve;
    });
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    let bStarted = false;

    class FakeWorker implements TopicWorker {
      idle = true;
      started = false;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {
        this.started = true;
        alive += 1;
        maxAlive = Math.max(maxAlive, alive);
        if (this.bindingId === "b") bStarted = true;
      }
      async stop(): Promise<void> {
        if (this.bindingId === "a") {
          signalStopEntered();
          await stopGate;
        }
        if (this.started) alive -= 1;
      }
    }

    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 1 },
    );
    await supervisor.ensure(binding({ bindingId: "a", threadId: 1 }));

    const stopping = supervisor.stop("a", "binding_revoked");
    await stopEntered;
    const startingB = supervisor.ensure(binding({ bindingId: "b", threadId: 2 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(supervisor.size()).toBe(1);
    expect(bStarted).toBe(false);
    expect(maxAlive).toBe(1);

    releaseStop();
    await Promise.all([stopping, startingB]);
    expect(bStarted).toBe(true);
    expect(maxAlive).toBe(1);
    expect(supervisor.size()).toBe(1);
  });

  test("stop waits for in-flight start and prevents late worker resurrection", async () => {
    let signalStarted!: () => void;
    let releaseStart!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });

    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {
        signalStarted();
        await startGate;
      }
      async stop(): Promise<void> {}
    }

    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 1 },
    );
    const a = binding({ bindingId: "a", threadId: 1 });

    const ensuring = supervisor.ensure(a);
    await started;
    const stopping = supervisor.stop("a", "binding_rotated");
    releaseStart();
    await Promise.allSettled([ensuring, stopping]);

    expect(supervisor.size()).toBe(0);
  });

  test("ensure fails closed instead of reusing a stale binding lease", async () => {
    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {}
      async stop(): Promise<void> {}
    }
    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 2 },
    );
    const first = binding({ bindingId: "a", threadId: 1 });
    await supervisor.ensure(first);

    await expect(supervisor.ensure({
      ...first,
      sessionId: "session-a-next",
      normalizedDirectory: "/workspace/a-next",
      bindingGeneration: first.bindingGeneration + 1,
    })).rejects.toThrow("binding identity mismatch");
  });

  test("failed worker start is cleaned up and generation remains monotonic", async () => {
    const stopped: number[] = [];
    let attempt = 0;

    class FakeWorker implements TopicWorker {
      idle = true;
      constructor(readonly bindingId: string, readonly generation: number) {}
      async start(): Promise<void> {
        attempt += 1;
        if (attempt === 1) throw new Error("start failed");
      }
      async stop(): Promise<void> { stopped.push(this.generation); }
    }

    const supervisor = new WorkerSupervisor(
      (b, g) => new FakeWorker(b.bindingId, g),
      { maxWorkers: 1 },
    );
    const a = binding({ bindingId: "a", threadId: 1 });

    await expect(supervisor.ensure(a)).rejects.toThrow("start failed");
    const recovered = await supervisor.ensure(a);

    expect(stopped).toEqual([1]);
    expect(recovered.generation).toBe(2);
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
