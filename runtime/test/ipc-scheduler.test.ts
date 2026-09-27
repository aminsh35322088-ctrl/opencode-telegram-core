import { describe, expect, test } from "bun:test";
import {
  BindingRegistry,
  InMemoryExecutionLedger,
  OutboundGateway,
  RunRegistry,
  ScheduledTaskDispatcher,
  WorkerOutboundGate,
  WorkerProtocolError,
  WorkerSupervisor,
  type BindingIdentity,
  type OutboundEnvelope,
  type ScheduledTaskRecord,
  type TopicWorker,
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

describe("worker IPC outbound fencing", () => {
  test("worker cannot spoof another binding even with a structurally valid envelope", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const a = binding("a", 11);
    const b = binding("b", 22);
    bindings.register(a);
    bindings.register(b);
    runs.start(a, 1, "run-a");
    const runB = runs.start(b, 1, "run-b");

    const sent: OutboundEnvelope[] = [];
    const gateway = new OutboundGateway(bindings, runs, {
      send: async (envelope) => { sent.push(envelope); },
    });
    const gateForA = new WorkerOutboundGate(
      { bindingId: "a", workerGeneration: 1 },
      gateway,
    );

    expect(await gateForA.accept({
      ...runB,
      operationId: "spoof-b",
      kind: "telegram.rich.final",
      payload: { text: "should never send" },
    })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test("malformed child-process message fails closed", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    const gateway = new OutboundGateway(bindings, runs, { send: async () => undefined });
    const gate = new WorkerOutboundGate({ bindingId: "a", workerGeneration: 1 }, gateway);

    await expect(gate.accept({ bindingId: "a" })).rejects.toBeInstanceOf(WorkerProtocolError);
  });
});

describe("scheduled task admission", () => {
  class FakeWorker implements TopicWorker {
    idle = true;
    constructor(readonly bindingId: string, readonly generation: number) {}
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
  }

  function taskFor(b: BindingIdentity, overrides: Partial<ScheduledTaskRecord> = {}): ScheduledTaskRecord {
    return {
      taskId: "task-1",
      executionId: "task-1:2026-09-27T00:00:00Z",
      bindingId: b.bindingId,
      botId: b.botId,
      chatId: b.chatId,
      threadId: b.threadId,
      sessionId: b.sessionId,
      normalizedDirectory: b.normalizedDirectory,
      bindingGeneration: b.bindingGeneration,
      payload: { prompt: "hello" },
      ...overrides,
    };
  }

  test("unbound scheduled task never starts a worker or execution", async () => {
    const bindings = new BindingRegistry();
    const runs = new RunRegistry();
    let workerStarts = 0;
    let executions = 0;
    const supervisor = new WorkerSupervisor((b, generation) => {
      workerStarts += 1;
      return new FakeWorker(b.bindingId, generation);
    }, { maxWorkers: 2 });
    const dispatcher = new ScheduledTaskDispatcher(
      bindings,
      runs,
      supervisor,
      new InMemoryExecutionLedger(),
      { execute: async () => { executions += 1; } },
    );

    expect(await dispatcher.dispatch(taskFor(binding()))).toBe("unbound");
    expect(workerStarts).toBe(0);
    expect(executions).toBe(0);
  });

  test("stale binding generation is rejected before worker execution", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    bindings.fence(b.bindingId);
    const runs = new RunRegistry();
    let executions = 0;
    const supervisor = new WorkerSupervisor(
      (current, generation) => new FakeWorker(current.bindingId, generation),
      { maxWorkers: 2 },
    );
    const dispatcher = new ScheduledTaskDispatcher(
      bindings,
      runs,
      supervisor,
      new InMemoryExecutionLedger(),
      { execute: async () => { executions += 1; } },
    );

    expect(await dispatcher.dispatch(taskFor(b))).toBe("stale_binding");
    expect(executions).toBe(0);
  });

  test("duplicate durable execution id is idempotently suppressed", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    let executions = 0;
    const supervisor = new WorkerSupervisor(
      (current, generation) => new FakeWorker(current.bindingId, generation),
      { maxWorkers: 2 },
    );
    const dispatcher = new ScheduledTaskDispatcher(
      bindings,
      runs,
      supervisor,
      new InMemoryExecutionLedger(),
      { execute: async () => { executions += 1; } },
    );
    const task = taskFor(b);

    expect(await dispatcher.dispatch(task)).toBe("executed");
    expect(await dispatcher.dispatch(task)).toBe("duplicate");
    expect(executions).toBe(1);
  });
});
