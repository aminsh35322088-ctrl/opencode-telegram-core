import { expect, test } from "bun:test";
import path from "node:path";
import { pollRunResult, type RunIdentity } from "../src/index.js";

const run: RunIdentity = { bindingId: "topic", botId: "bot", chatId: 1, threadId: 2,
  sessionId: "parent", normalizedDirectory: path.resolve("/workspace/topic"),
  bindingGeneration: 1, workerGeneration: 1, runId: "run" };
const options = () => ({ signal: new AbortController().signal, timeoutMs: 100, intervalMs: 1, maxAttempts: 3, isCurrent: () => true });

test("polling returns a completed result after bounded pending reads", async () => {
  let reads = 0;
  const result = await pollRunResult(run, async () => ++reads === 2 ? { status: "complete", value: "result" } : { status: "pending" }, options());
  expect(result).toBe("result");
  expect(reads).toBe(2);
});

test("polling rejects a result whose run was fenced while its read was pending", async () => {
  let current = true;
  await expect(pollRunResult(run, async () => {
    current = false; return { status: "complete", value: "stale" };
  }, { ...options(), isCurrent: () => current })).rejects.toThrow("no longer current");
});

test("a stale or already cancelled poll never calls its reader", async () => {
  let reads = 0;
  const read = async () => { reads++; return { status: "complete" as const, value: "bad" }; };
  await expect(pollRunResult(run, read, { ...options(), isCurrent: () => false })).rejects.toThrow("no longer current");
  const controller = new AbortController(); controller.abort();
  await expect(pollRunResult(run, read, { ...options(), signal: controller.signal })).rejects.toThrow();
  expect(reads).toBe(0);
});

test("attempt exhaustion stops instead of polling forever", async () => {
  let reads = 0;
  await expect(pollRunResult(run, async () => { reads++; return { status: "pending" }; }, options())).rejects.toThrow("attempt limit");
  expect(reads).toBe(3);
});

test("a hung reader is bounded and its signal is aborted on timeout", async () => {
  let readSignal!: AbortSignal;
  await expect(pollRunResult(run, async (signal) => { readSignal = signal; return await new Promise<never>(() => {}); },
    { ...options(), timeoutMs: 10 })).rejects.toThrow("deadline");
  expect(readSignal.aborted).toBe(true);
});

test("cancellation interrupts a hung read without waiting for the deadline", async () => {
  const controller = new AbortController();
  let ready!: () => void;
  const reading = new Promise<void>((resolve) => { ready = resolve; });
  let readSignal!: AbortSignal;
  const result = pollRunResult(run, async (signal) => { readSignal = signal; ready(); return await new Promise<never>(() => {}); },
    { ...options(), timeoutMs: 1_000, signal: controller.signal });
  await reading; controller.abort(new Error("owner aborted"));
  await expect(result).rejects.toThrow("owner aborted");
  expect(readSignal.aborted).toBe(true);
});

test("reader failures propagate without implicit retries", async () => {
  let reads = 0;
  await expect(pollRunResult(run, async () => { reads++; return { status: "failed", error: new Error("transport failed") }; }, options())).rejects.toThrow("transport failed");
  expect(reads).toBe(1);
});

test("Topic cancellation cannot affect another concurrent poll", async () => {
  const controller = new AbortController();
  let ready!: () => void;
  const reading = new Promise<void>((resolve) => { ready = resolve; });
  const a = pollRunResult(run, async () => { ready(); return { status: "pending" }; }, { ...options(), signal: controller.signal, intervalMs: 100 });
  await reading;
  const b = pollRunResult({ ...run, bindingId: "other", threadId: 3, sessionId: "other", normalizedDirectory: path.resolve("/workspace/other") },
    async () => ({ status: "complete", value: "other output" }), options());
  controller.abort();
  await expect(a).rejects.toThrow();
  expect(await b).toBe("other output");
});

test("pending readers may request a shorter bounded diagnostic recheck", async () => {
  let reads = 0;
  const result = await pollRunResult(run, async () => ++reads === 2
    ? { status: "complete", value: "confirmed" }
    : { status: "pending", retryAfterMs: 1 }, { ...options(), intervalMs: 200, timeoutMs: 100 });
  expect(result).toBe("confirmed");
});

test("invalid pending delays cannot create tight or unbounded loops", async () => {
  for (const retryAfterMs of [0, -1, Infinity, NaN]) {
    await expect(pollRunResult(run, async () => ({ status: "pending", retryAfterMs }), options())).rejects.toThrow("delay");
  }
});
