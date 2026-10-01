import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenCodeTopicWorker, TelegramNativeCore, type BindingIdentity, type OpenCodeExecutionControlPort, type OpenCodeExecutionTarget, type RuntimeExecutionInfo } from "../src/index.js";

const fixtures: Array<{ core: TelegramNativeCore; root: string }> = [];
afterEach(async () => {
  for (const { core, root } of fixtures.splice(0)) {
    await core.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(port: OpenCodeExecutionControlPort, timeoutMs = 100) {
  const root = await mkdtemp(path.join(os.tmpdir(), "core-control-"));
  const binding: BindingIdentity = { bindingId: "topic", botId: "bot", chatId: 10, threadId: 11,
    sessionId: "root-session", normalizedDirectory: path.resolve(root, "workspace"), bindingGeneration: 1 };
  await writeFile(path.join(root, "bindings.json"), JSON.stringify({ version: 1, records: [{ lifecycle: "ACTIVE", binding }] }));
  const aborted: string[] = []; const sent: string[] = [];
  const core = await TelegramNativeCore.open({
    bindingStorePath: path.join(root, "bindings.json"),
    workerFactory: (binding, generation) => new OpenCodeTopicWorker(binding, generation, null, {
      promptTimeoutMs: 1000, cancellationGraceMs: 10, stopTimeoutMs: 100,
      abortSession: async (target) => { aborted.push(target.sessionId); },
    }),
    outboundSink: { send: async (envelope) => { sent.push(envelope.runId); } },
    richMessagePort: { sendDraft: async () => {}, sendFinal: async () => {} },
    nativeMarkdownStreamPort: { streamMarkdown: async () => {} },
    abortRun: async () => {}, admissionPolicy: () => "MODEL_ALLOWED",
    railwayPolicy: { softRssBytes: Number.MAX_SAFE_INTEGER - 1, hardRssBytes: Number.MAX_SAFE_INTEGER,
      maxWorkers: 4, maxRestartsPerBinding: 3, restartWindowMs: 60000 },
    executionControl: { port, requestTimeoutMs: timeoutMs },
  });
  fixtures.push({ core, root });
  const run = await core.beginRun(binding.bindingId, "logical-run");
  return { core, binding, run, aborted, sent };
}

function ack(target: OpenCodeExecutionTarget, paused: boolean): RuntimeExecutionInfo {
  return { runId: target.runId, paused, continuation: "live" };
}

test("native pause and resume use the existing owned run without abort or recreation", async () => {
  const requests: Array<{ action: string; target: OpenCodeExecutionTarget }> = [];
  const { core, run, aborted } = await fixture({
    pause: async (target) => { requests.push({ action: "pause", target }); return ack(target, true); },
    resume: async (target) => { requests.push({ action: "resume", target }); return ack(target, false); },
    execution: async (target) => ack(target, false),
  });
  await core.dispatchTask(run, "admit", async () => {});
  expect(await core.pauseRun(run)).toEqual({ runId: "logical-run", paused: true, continuation: "live" });
  expect(core.runs.accepts(run)).toBe(true);
  expect(core.runs.activity(run).paused).toBe(true);
  expect(await core.resumeRun(run)).toEqual({ runId: "logical-run", paused: false, continuation: "live" });
  expect(core.runs.activity(run).paused).toBe(false);
  expect(requests).toEqual([
    { action: "pause", target: { sessionId: "root-session", directory: run.normalizedDirectory, runId: "logical-run" } },
    { action: "resume", target: { sessionId: "root-session", directory: run.normalizedDirectory, runId: "logical-run" } },
  ]);
  expect(aborted).toEqual([]);
});

test("pending pause holds delivery until a live runtime acknowledgment", async () => {
  let acknowledge!: (info: RuntimeExecutionInfo) => void;
  const { core, run, sent } = await fixture({
    pause: async () => new Promise((resolve) => { acknowledge = resolve; }),
    resume: async (target) => ack(target, false), execution: async (target) => ack(target, false),
  });
  await core.dispatchTask(run, "admit", async () => {});
  const pause = core.pauseRun(run);
  const delivery = core.outbound.dispatch({ ...run, operationId: "send", kind: "text", payload: "held" });
  await Bun.sleep(10);
  expect(sent).toEqual([]);
  acknowledge({ runId: "logical-run", paused: true, continuation: "live" });
  await pause;
  await core.resumeRun(run);
  expect(await delivery).toBe(true);
  expect(sent).toEqual(["logical-run"]);
});

test("queued control requests preserve pause then resume ordering", async () => {
  let acknowledge!: (info: RuntimeExecutionInfo) => void;
  const requests: string[] = [];
  const { core, run } = await fixture({
    pause: async () => { requests.push("pause"); return new Promise((resolve) => { acknowledge = resolve; }); },
    resume: async (target) => { requests.push("resume"); return ack(target, false); },
    execution: async (target) => ack(target, false),
  });
  await core.dispatchTask(run, "admit", async () => {});
  const pause = core.pauseRun(run); const resume = core.resumeRun(run);
  await Bun.sleep(5);
  expect(requests).toEqual(["pause"]);
  acknowledge({ runId: "logical-run", paused: true, continuation: "live" });
  await pause; await resume;
  expect(requests).toEqual(["pause", "resume"]);
  expect(core.runs.activity(run).paused).toBe(false);
});

test("control follows a task's actual temporary target in the same workspace", async () => {
  let target!: OpenCodeExecutionTarget;
  const { core, run } = await fixture({
    pause: async (owner) => { target = owner; return ack(owner, true); },
    resume: async (owner) => ack(owner, false), execution: async (owner) => ack(owner, false),
  });
  await core.dispatchTask(run, "temporary", async ({ setAbortTarget }) => {
    setAbortTarget({ sessionId: "temporary-session", directory: run.normalizedDirectory });
  }, { abortTarget: null });
  await core.pauseRun(run);
  expect(target).toEqual({ sessionId: "temporary-session", directory: run.normalizedDirectory, runId: "logical-run" });
  await core.resumeRun(run);
});

test("a run without an admitted execution target cannot create one through pause", async () => {
  let requests = 0;
  const { core, run } = await fixture({
    pause: async (target) => { requests++; return ack(target, true); },
    resume: async (target) => ack(target, false), execution: async (target) => ack(target, false),
  });
  await expect(core.pauseRun(run)).rejects.toThrow("execution target");
  expect(requests).toBe(0);
  expect(core.runs.activity(run).paused).toBe(false);
});

test.skipIf(process.platform === "win32")("a late pause acknowledgment cannot affect a rotated Topic generation", async () => {
  let acknowledge!: (info: RuntimeExecutionInfo) => void;
  const { core, run, binding } = await fixture({
    pause: async () => new Promise((resolve) => { acknowledge = resolve; }),
    resume: async (target) => ack(target, false), execution: async (target) => ack(target, false),
  });
  await core.dispatchTask(run, "admit", async () => {});
  const pending = core.pauseRun(run).catch((error: unknown) => error);
  await Bun.sleep(5);
  await core.rotateBinding(binding.bindingId, { sessionId: "replacement-session", normalizedDirectory: binding.normalizedDirectory });
  const next = await core.beginRun(binding.bindingId, "next-run");
  acknowledge({ runId: "logical-run", paused: true, continuation: "live" });
  expect(await pending).toBeInstanceOf(Error);
  expect(core.runs.activity(next).paused).toBe(false);
  expect(core.runs.accepts(next)).toBe(true);
});

test("unavailable runtime continuation holds output and requires explicit cleanup", async () => {
  const { core, run, sent } = await fixture({
    pause: async (target) => ({ ...ack(target, true), continuation: "unavailable" }),
    resume: async (target) => ack(target, false), execution: async (target) => ack(target, false),
  });
  await core.dispatchTask(run, "admit", async () => {});
  await expect(core.pauseRun(run)).rejects.toThrow("acknowledgment");
  await expect(core.resumeRun(run)).rejects.toThrow("uncertain");
  const delivery = core.outbound.dispatch({ ...run, operationId: "send", kind: "text", payload: "unsafe" });
  await Bun.sleep(5);
  expect(sent).toEqual([]);
  core.finishRun(run);
  expect(await delivery).toBe(false);
});

test("ambiguous control timeout never reports success or triggers implicit abort", async () => {
  let signal!: AbortSignal;
  const { core, run, aborted } = await fixture({
    pause: async (_target, requestSignal) => { signal = requestSignal; return new Promise(() => {}); },
    resume: async (target) => ack(target, false), execution: async (target) => ack(target, false),
  }, 10);
  await core.dispatchTask(run, "admit", async () => {});
  await expect(core.pauseRun(run)).rejects.toThrow("deadline");
  expect(signal.aborted).toBe(true);
  expect(aborted).toEqual([]);
  expect(core.runs.accepts(run)).toBe(true);
  await expect(core.inspectExecution(run)).rejects.toThrow("uncertain");
});

test("a fence before transport admission prevents sending the control request", async () => {
  let requests = 0;
  const { core, run } = await fixture({
    pause: async (target) => { requests++; return ack(target, true); },
    resume: async (target) => ack(target, false), execution: async (target) => ack(target, false),
  });
  await core.dispatchTask(run, "admit", async () => {});
  const pending = core.pauseRun(run).catch((error: unknown) => error);
  queueMicrotask(() => core.runs.fence(run.bindingId));
  expect(await pending).toBeInstanceOf(Error);
  expect(requests).toBe(0);
});
