import { describe, expect, test } from "bun:test";
import {
  AuthoritativeRunReconciler,
  OpenCodeSessionClient,
  RunRegistry,
  SessionEventIntegrityError,
  type BindingIdentity,
  type FetchLike,
  type OpenCodeRunStatusPort,
} from "../src/index.js";

function binding(): BindingIdentity {
  return {
    bindingId: "binding-a",
    botId: "bot-main",
    chatId: 100,
    threadId: 11,
    sessionId: "session-a",
    normalizedDirectory: "/workspace/a",
    bindingGeneration: 1,
  };
}

function sse(event: unknown): Response {
  const bytes = new TextEncoder().encode("data: " + JSON.stringify(event) + "\n\n");
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("OpenCode durable session event client", () => {
  test("reconnect resumes strictly after last durable sequence", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("after=0")) {
        return sse({ durable: { aggregateID: "session-a", seq: 1 }, type: "one" });
      }
      if (url.endsWith("after=1")) {
        return sse({ durable: { aggregateID: "session-a", seq: 2 }, type: "two" });
      }
      throw new Error("unexpected URL " + url);
    };
    const client = new OpenCodeSessionClient({
      baseUrl: "http://127.0.0.1:4096",
      requestTimeoutMs: 100,
      eventIdleTimeoutMs: 100,
      reconnectDelayMs: 1,
      maxReconnects: 2,
      fetchImpl,
    });
    const iterator = client.events("session-a", 0);

    expect((await iterator.next()).value?.durable.seq).toBe(1);
    expect((await iterator.next()).value?.durable.seq).toBe(2);
    await iterator.return();

    expect(urls.some((url) => url.endsWith("after=0"))).toBe(true);
    expect(urls.some((url) => url.endsWith("after=1"))).toBe(true);
  });

  test("cross-session event is rejected instead of being retried or delivered", async () => {
    const client = new OpenCodeSessionClient({
      baseUrl: "http://127.0.0.1:4096",
      requestTimeoutMs: 100,
      eventIdleTimeoutMs: 100,
      reconnectDelayMs: 1,
      maxReconnects: 3,
      fetchImpl: async () => sse({
        durable: { aggregateID: "session-b", seq: 1 },
        type: "leak",
      }),
    });
    const iterator = client.events("session-a", 0);

    await expect(iterator.next()).rejects.toBeInstanceOf(SessionEventIntegrityError);
  });
});

describe("authoritative run reconciliation", () => {
  test("late terminal probe cannot clear a replacement run", async () => {
    const runs = new RunRegistry();
    const b = binding();
    const oldRun = runs.start(b, 1, "old-run");
    let resolveStatus!: (status: "idle") => void;
    const status = new Promise<"idle">((resolve) => { resolveStatus = resolve; });
    const port: OpenCodeRunStatusPort = {
      status: async () => status,
      interrupt: async () => undefined,
    };
    const reconciler = new AuthoritativeRunReconciler(runs, port, {
      requestTimeoutMs: 500,
      providerRetryCeilingMs: 1_000,
    });
    const probe = reconciler.probe(oldRun, Date.now());

    const replacement = runs.start(b, 1, "new-run");
    resolveStatus("idle");

    expect(await probe).toBe("stale");
    expect(runs.current(b.bindingId)?.runId).toBe(replacement.runId);
  });

  test("provider retry beyond absolute ceiling is interrupted and finalized", async () => {
    const runs = new RunRegistry();
    const run = runs.start(binding(), 1, "retry-run");
    let interrupts = 0;
    const port: OpenCodeRunStatusPort = {
      status: async () => "retry",
      interrupt: async () => { interrupts += 1; },
    };
    const reconciler = new AuthoritativeRunReconciler(runs, port, {
      requestTimeoutMs: 100,
      providerRetryCeilingMs: 1_000,
      now: () => 10_000,
    });

    expect(await reconciler.probe(run, 0)).toBe("aborted_retry_ceiling");
    expect(interrupts).toBe(1);
    expect(runs.current(run.bindingId)).toBeNull();
  });
});
