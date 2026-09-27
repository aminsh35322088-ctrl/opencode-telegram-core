import { describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BindingRegistry,
  OutboundGateway,
  RunRegistry,
  WorkerOutboundGate,
  consumeWorkerJsonLines,
  type BindingIdentity,
  type OutboundEnvelope,
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

describe("real child-process IPC boundary", () => {
  test("child worker A cannot spoof active run owned by binding B", async () => {
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
    const gate = new WorkerOutboundGate(
      { bindingId: a.bindingId, workerGeneration: 1 },
      gateway,
    );

    const spoof = {
      ...runB,
      operationId: "child-spoof",
      kind: "telegram.rich.final",
      payload: { text: "foreign output" },
    };
    const fixture = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "fixtures",
      "emit-envelope.ts",
    );
    const child = Bun.spawn(
      [process.execPath, fixture, JSON.stringify(spoof)],
      { stdout: "pipe", stderr: "pipe" },
    );

    const stats = await consumeWorkerJsonLines(child.stdout, gate);
    expect(await child.exited).toBe(0);
    expect(stats).toEqual({ accepted: 0, rejected: 1, protocolErrors: 0 });
    expect(sent).toHaveLength(0);
  });
});
