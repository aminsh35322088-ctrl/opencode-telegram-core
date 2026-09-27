import { describe, expect, test } from "bun:test";
import {
  OpenCodeTopicWorker,
  type BindingIdentity,
  type OpenCodePromptPort,
  type RunIdentity,
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

function runFor(binding: BindingIdentity, generation: number, runId: string): RunIdentity {
  return { ...binding, workerGeneration: generation, runId };
}

describe("per-binding OpenCode TopicWorker", () => {
  test("prompt is admitted only to worker-owned session with runId as request id", async () => {
    const calls: Array<{ sessionId: string; id?: string; text: string }> = [];
    const client: OpenCodePromptPort = {
      prompt: async (sessionId, prompt, options) => {
        calls.push({
          sessionId,
          text: prompt.text,
          ...(options?.id === undefined ? {} : { id: options.id }),
        });
        return {
          admittedSeq: 1,
          id: options?.id ?? "generated",
          sessionID: sessionId,
          delivery: options?.delivery ?? "queue",
          timeCreated: 1,
        };
      },
    };
    const b = binding("a", 11);
    const worker = new OpenCodeTopicWorker(b, 3, client, {
      promptTimeoutMs: 1_000,
      cancellationGraceMs: 50,
      stopTimeoutMs: 100,
    });
    await worker.start(b);

    const admitted = await worker.executePrompt(runFor(b, 3, "run-123"), { text: "hello" });

    expect(admitted.sessionID).toBe("session-a");
    expect(calls).toEqual([{ sessionId: "session-a", id: "run-123", text: "hello" }]);
    expect(worker.idle).toBe(true);
  });

  test("foreign Topic run is rejected before OpenCode is called", async () => {
    let calls = 0;
    const client: OpenCodePromptPort = {
      prompt: async () => {
        calls += 1;
        throw new Error("must not call");
      },
    };
    const a = binding("a", 11);
    const b = binding("b", 22);
    const worker = new OpenCodeTopicWorker(a, 1, client, {
      promptTimeoutMs: 1_000,
      cancellationGraceMs: 50,
      stopTimeoutMs: 100,
    });
    await worker.start(a);

    expect(() => worker.executePrompt(runFor(b, 1, "run-b"), { text: "leak" })).toThrow(
      "run does not belong",
    );
    expect(calls).toBe(0);
  });

  test("stopping worker A aborts its active prompt without touching worker B", async () => {
    const aborted: string[] = [];
    let markStartedA!: () => void;
    const startedA = new Promise<void>((resolve) => { markStartedA = resolve; });
    const client: OpenCodePromptPort = {
      prompt: async (sessionId, _prompt, options) => {
        if (sessionId === "session-b") {
          return {
            admittedSeq: 1,
            id: "b",
            sessionID: sessionId,
            delivery: "queue",
            timeCreated: 1,
          };
        }
        markStartedA();
        return await new Promise((_resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) {
            aborted.push(sessionId);
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => {
            aborted.push(sessionId);
            reject(signal.reason);
          }, { once: true });
        });
      },
    };
    const a = binding("a", 11);
    const b = binding("b", 22);
    const workerA = new OpenCodeTopicWorker(a, 1, client, {
      promptTimeoutMs: 5_000,
      cancellationGraceMs: 50,
      stopTimeoutMs: 500,
    });
    const workerB = new OpenCodeTopicWorker(b, 1, client, {
      promptTimeoutMs: 5_000,
      cancellationGraceMs: 50,
      stopTimeoutMs: 500,
    });
    await workerA.start(a);
    await workerB.start(b);

    const promptA = workerA.executePrompt(runFor(a, 1, "a"), { text: "hang" });
    const promptB = workerB.executePrompt(runFor(b, 1, "b"), { text: "ok" });
    await startedA;
    await workerA.stop("test");

    await expect(promptA).rejects.toThrow();
    expect((await promptB).sessionID).toBe("session-b");
    expect(aborted).toEqual(["session-a"]);
    expect(workerB.idle).toBe(true);
  });
});
