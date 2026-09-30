import { expect, test } from "bun:test";
import { withDeadline } from "../src/index.js";

test("a pre-aborted parent never starts deadline work", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  let calls = 0;
  await expect(withDeadline(async () => { calls++; return "unsafe"; }, { timeoutMs: 100, label: "read", parentSignal: controller.signal })).rejects.toThrow("cancelled");
  expect(calls).toBe(0);
});

test("parent abort rejects deadline work even when its dependency ignores the signal", async () => {
  const controller = new AbortController();
  let signal!: AbortSignal;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const result = withDeadline(async (input) => { signal = input; ready(); return await new Promise<never>(() => {}); }, { timeoutMs: 1_000, label: "read", parentSignal: controller.signal });
  await started;
  controller.abort(new Error("cancelled"));
  await expect(result).rejects.toThrow("cancelled");
  expect(signal.aborted).toBe(true);
});

test("synchronous parent cancellation cannot return a successful deadline result", async () => {
  const controller = new AbortController();
  await expect(withDeadline(() => {
    controller.abort(new Error("cancelled during startup"));
    return Promise.resolve("unsafe success");
  }, { timeoutMs: 100, label: "read", parentSignal: controller.signal })).rejects.toThrow("cancelled during startup");
});

test("synchronous cancellation and throw are both handled by the deadline race", async () => {
  const controller = new AbortController();
  await expect(withDeadline(() => {
    controller.abort(new Error("cancelled before throw"));
    throw new Error("read failed");
  }, { timeoutMs: 100, label: "read", parentSignal: controller.signal })).rejects.toThrow();
  await Promise.resolve();
});
