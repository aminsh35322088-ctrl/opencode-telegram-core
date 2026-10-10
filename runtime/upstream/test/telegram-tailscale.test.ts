import { expect, test } from "bun:test"
import { createToolProcessScope } from "@opencode-ai/core/telegram-tool-process"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import { acquireNetworkBudget } from "@opencode-ai/core/telegram-tailscale"
import { TelegramProcessBudgetGovernor } from "@opencode-ai/core/telegram-process-budget"

test("network waits for held helper admission without increasing governor limits", async () => {
  const governor = new TelegramProcessBudgetGovernor(4, () => ({memoryUsedBytes:0,memoryLimitBytes:null,memoryPressure:null}), () => true)
  const held = governor.acquire("startup",undefined,"helper")!
  const execution = new SessionExecutionControl().start({sessionId:"session",runId:"run",directory:"/tmp"})
  let admitted = false
  const pending = acquireNetworkBudget(execution,execution.epoch,new AbortController().signal,governor.acquire.bind(governor))
    .then(value => {admitted=true;return value})
  await Bun.sleep(50)
  expect(admitted).toBe(false)
  expect(governor.snapshot().activeCount).toBe(1)
  held.release()
  const scopes = await pending
  expect(governor.snapshot().activeByKind).toEqual({helper:1,utility:1})
  for (const scope of scopes) scope.release()
  expect(governor.snapshot().activeCount).toBe(0)
})

test("network admission releases partial reservation on utility contention and cancellation", async () => {
  const governor = new TelegramProcessBudgetGovernor(4, () => ({memoryUsedBytes:0,memoryLimitBytes:null,memoryPressure:null}), () => true)
  const held = [governor.acquire("git",undefined,"utility")!,governor.acquire("git",undefined,"utility")!]
  const execution = new SessionExecutionControl().start({sessionId:"session",runId:"run",directory:"/tmp"})
  const cancellation = new AbortController()
  const pending = acquireNetworkBudget(execution,execution.epoch,cancellation.signal,governor.acquire.bind(governor))
  const rejected = pending.then(() => undefined, error => error)
  await Bun.sleep(50)
  expect(governor.snapshot().activeByKind).toEqual({utility:2})
  cancellation.abort(new Error("cancelled admission"))
  expect((await rejected)?.message).toBe("cancelled admission")
  for (const scope of held) scope.release()
  expect(governor.snapshot().activeCount).toBe(0)
})

test("network admission cannot survive execution retirement", async () => {
  const governor = new TelegramProcessBudgetGovernor(4, () => ({memoryUsedBytes:0,memoryLimitBytes:null,memoryPressure:null}), () => true)
  const held = governor.acquire("startup",undefined,"helper")!
  const execution = new SessionExecutionControl().start({sessionId:"session",runId:"run",directory:"/tmp"})
  const pending = acquireNetworkBudget(execution,execution.epoch,new AbortController().signal,governor.acquire.bind(governor))
  const rejected = pending.then(() => undefined, error => error)
  await Bun.sleep(30)
  execution.retire()
  expect((await rejected)?.message).toBe("execution owner retired")
  expect(governor.snapshot().activeCount).toBe(1)
  held.release()
})

test("network admission fails closed immediately under memory pressure", async () => {
  const governor = new TelegramProcessBudgetGovernor(4, () => ({memoryUsedBytes:1024,memoryLimitBytes:1024,memoryPressure:1}), () => true)
  const execution = new SessionExecutionControl().start({sessionId:"session",runId:"run",directory:"/tmp"})
  await expect(acquireNetworkBudget(execution,execution.epoch,new AbortController().signal,governor.acquire.bind(governor)))
    .rejects.toMatchObject({reason:"memory_pressure"})
  expect(governor.snapshot().activeCount).toBe(0)
})

test("network authority requires captured live Core execution", async () => {
  const scope = createToolProcessScope(undefined, undefined, "session", "/tmp", new AbortController().signal)
  expect(typeof (scope.port as any).network).toBe("function")
  await expect((scope.port as any).network({action:"status"})).rejects.toThrow("live runtime execution")
  await scope.close()
})

test("network authority rejects foreign workspace before delegated execution", async () => {
  const execution = new SessionExecutionControl().start({sessionId:"session",runId:"run",directory:"/tmp/foreign"})
  const scope = createToolProcessScope(execution,execution.epoch,"session","/tmp",new AbortController().signal)
  expect(typeof (scope.port as any).network).toBe("function")
  await expect((scope.port as any).network({action:"status"})).rejects.toThrow("owner mismatch")
  await scope.close()
})
