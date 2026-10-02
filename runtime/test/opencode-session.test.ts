import { describe, expect, test } from "bun:test";
import {
  AuthoritativeRunReconciler,
  OpenCodeSessionClient,
  RunRegistry,
  SessionEventIntegrityError,
  SessionEventStreamLostError,
  type BindingIdentity,
  type FetchLike,
  type OpenCodeRunStatusPort,
} from "../src/compat.js";

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

  test("a stream that yields one event per connection still exhausts the reconnect budget", async () => {
    let attempts = 0;
    const client = new OpenCodeSessionClient({
      baseUrl: "http://127.0.0.1:4096",
      requestTimeoutMs: 100,
      eventIdleTimeoutMs: 100,
      reconnectDelayMs: 1,
      maxReconnects: 2,
      fetchImpl: async () => {
        attempts += 1;
        return sse({ durable: { aggregateID: "session-a", seq: attempts }, type: "flap" });
      },
    });

    let delivered = 0;
    const iterator = client.events("session-a", 0);
    const drain = (async () => {
      for await (const _ of iterator) {
        delivered += 1;
        if (delivered > 10) return;
      }
    })();

    await expect(drain).rejects.toBeInstanceOf(SessionEventStreamLostError);
    expect(attempts).toBeLessThanOrEqual(3);
  });

  test("streaming many events leaves no idle timer pending per event", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    let created = 0;
    let cleared = 0;
    // Count only the long idle-window timers; the 0ms drain timers below are an
    // artefact of driving the stream in-process.
    globalThis.setTimeout = function patched(handler: TimerHandler, ms?: number, ...args: unknown[]) {
      if ((ms ?? 0) >= 1000) created += 1;
      return realSetTimeout(handler, ms, ...args);
    } as typeof globalThis.setTimeout;
    globalThis.clearTimeout = function patched(handle: Parameters<typeof globalThis.clearTimeout>[0]) {
      cleared += 1;
      return realClearTimeout(handle);
    } as typeof globalThis.clearTimeout;

    try {
      const total = 40;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          for (let seq = 1; seq <= total; seq += 1) {
            controller.enqueue(encoder.encode(
              "data: " + JSON.stringify({ durable: { aggregateID: "session-a", seq } }) + "\n\n",
            ));
            await new Promise((resolve) => { realSetTimeout(resolve, 0); });
          }
          controller.close();
        },
      });
      const client = new OpenCodeSessionClient({
        baseUrl: "http://127.0.0.1:4096",
        requestTimeoutMs: 60_000,
        eventIdleTimeoutMs: 30_000,
        reconnectDelayMs: 1,
        maxReconnects: 0,
        fetchImpl: async () => new Response(body, { status: 200 }),
      });

      const iterator = client.events("session-a", 0);
      let received = 0;
      try {
        for await (const _ of iterator) {
          received += 1;
          if (received >= total) break;
        }
      } catch {
        // maxReconnects 0 refuses the follow-up connection; not under test here.
      }

      expect(received).toBe(total);
      expect(created - cleared).toBeLessThanOrEqual(1);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    }
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

  test("a terminal probe finalizes through the injected finishRun hook", async () => {
    const runs = new RunRegistry();
    const run = runs.start(binding(), 1, "terminal-run");
    const finalized: string[] = [];
    const port: OpenCodeRunStatusPort = {
      status: async () => "idle",
      interrupt: async () => undefined,
    };
    const reconciler = new AuthoritativeRunReconciler(runs, port, {
      requestTimeoutMs: 100,
      providerRetryCeilingMs: 1_000,
      // Stands in for TelegramNativeCore.finishRun, which also clears the
      // per-run liveness and stuck bookkeeping.
      finishRun: (candidate) => {
        finalized.push(candidate.runId);
        runs.finish(candidate);
      },
    });

    expect(await reconciler.probe(run, 0)).toBe("terminal");
    expect(finalized).toEqual(["terminal-run"]);
    expect(runs.current(run.bindingId)).toBeNull();
  });
});
