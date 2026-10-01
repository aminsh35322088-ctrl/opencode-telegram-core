import { expect, test } from "bun:test";
import { withDeadline, type DeadlineActivity } from "../src/index.js";
import { SessionExecutionControl } from "../upstream/session-execution-control.js";

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

function activity(initiallyPaused: boolean): DeadlineActivity & { setPaused(value: boolean): void; readonly listeners: number } {
  let paused = initiallyPaused;
  const listeners = new Set<(error?: unknown) => void>();
  return {
    get paused() { return paused; },
    get listeners() { return listeners.size; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setPaused(value) { paused = value; for (const listener of listeners) listener(); },
  };
}

test("a paused active-time deadline does not cancel its work and expires after resume", async () => {
  const state = activity(true);
  let signal!: AbortSignal;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const result = withDeadline(async (input) => { signal = input; ready(); return await new Promise<never>(() => {}); }, { timeoutMs: 30, label: "paused child", activity: state });
  // Attach rejection handling before waiting past the old wall-clock deadline.
  const outcome = result.then(() => "unexpected success", (error: unknown) => error);
  await started;
  await Bun.sleep(60);
  expect(signal.aborted).toBe(false);
  state.setPaused(false);
  const error = await outcome;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("paused child exceeded 30ms deadline");
  expect(signal.aborted).toBe(true);
  expect(state.listeners).toBe(0);
});

test("parent cancellation still rejects a paused deadline and removes its activity listener", async () => {
  const state = activity(true);
  const parent = new AbortController();
  const result = withDeadline(async () => await new Promise<never>(() => {}), { timeoutMs: 10_000, label: "child", activity: state, parentSignal: parent.signal });
  parent.abort(new Error("parent cancelled while paused"));
  await expect(result).rejects.toThrow("parent cancelled while paused");
  expect(state.listeners).toBe(0);
});

test("a paused child's deadline rejects inherited admission failure instead of hanging", async () => {
  const control = new SessionExecutionControl();
  const parent = control.start({ sessionId: "parent", runId: "run-1", directory: "/topic-a" });
  const child = control.start({ sessionId: "child", runId: "run-1", directory: "/topic-a" }, parent.owner);
  control.pause(parent.owner);
  const result = withDeadline((signal) => child.checkpoint(signal), { timeoutMs: 10_000, label: "paused child", activity: child, parentSignal: child.signal });
  const outcome = result.catch((error: unknown) => error);
  expect(() => parent.attach({ pause: () => { throw new Error("suspend failed"); }, resume: () => {}, terminate: () => {} })).toThrow("suspend failed");
  expect((await outcome as Error).message).toContain("suspend failed");
  control.close(parent.owner);
});

test("ordinary parent completion does not cancel an existing child's active-time deadline", async () => {
  const control = new SessionExecutionControl();
  const parent = control.start({ sessionId: "parent", runId: "run-1", directory: "/topic-a" });
  const child = control.start({ sessionId: "child", runId: "run-1", directory: "/topic-a" }, parent.owner);
  control.pause(parent.owner);
  const result = withDeadline(async (signal) => { await child.checkpoint(signal); return "same continuation"; }, { timeoutMs: 1_000, label: "child", activity: child, parentSignal: child.signal });
  control.finish(parent.owner);
  expect(child.signal.aborted).toBe(false);
  control.resume(parent.owner);
  expect(await result).toBe("same continuation");
  control.finish(child.owner);
});

test("an earlier deadline observer receives failure from a later throwing observer", async () => {
  const control = new SessionExecutionControl();
  const run = control.start({ sessionId: "parent", runId: "run-1", directory: "/topic-a" });
  const result = withDeadline(async () => await new Promise<never>(() => {}), { timeoutMs: 100, label: "observer", activity: run });
  const outcome = result.catch((error: unknown) => error);
  run.subscribe(() => { throw new Error("later observer failed"); });
  expect(() => control.finish(run.owner)).toThrow("execution activity observer failed");
  expect((await outcome as Error).message).toContain("execution activity observer failed");
  control.close(run.owner);
});
