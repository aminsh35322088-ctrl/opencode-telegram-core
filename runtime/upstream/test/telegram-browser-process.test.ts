import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { WorkspaceBrowsers } from "@opencode-ai/core/telegram-browser-process"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import { createToolProcessScope } from "@opencode-ai/core/telegram-tool-process"

test("browser authority requires the captured workspace and live invocation", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "browser-authority-")))
  let active = true
  const browsers = new WorkspaceBrowsers(directory, () => { if (!active) throw new Error("workspace retired") })
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "topic-a", runId: "first", directory })
  const scope = createToolProcessScope(execution, execution.epoch, "topic-a", directory, new AbortController().signal, browsers)
  try {
    expect(await scope.port.browser({ action: "close" })).toEqual({ stdout: "Browser closed", stderr: "" })
    await scope.close()
    await expect(scope.port.browser({ action: "close" })).rejects.toThrow()
    control.finish(execution.owner)
    const replacement = control.start({ sessionId: "topic-a", runId: "second", directory })
    const current = createToolProcessScope(replacement, replacement.epoch, "topic-a", directory, new AbortController().signal, browsers)
    active = false
    await expect(current.port.browser({ action: "close" })).rejects.toThrow("workspace retired")
    await current.close()
    control.finish(replacement.owner)
  } finally { await browsers.close(); await rm(directory, { recursive: true, force: true }) }
})

test("browser requests cannot select a foreign topic or unavailable workspace owner", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "browser-foreign-")))
  const browsers = new WorkspaceBrowsers(directory, () => {})
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "topic-a", runId: "first", directory })
  const scope = createToolProcessScope(execution, execution.epoch, "topic-a", directory, new AbortController().signal)
  try {
    await expect(scope.port.browser({ action: "open" })).rejects.toThrow()
    await expect(browsers.execute(execution, execution.epoch, "topic-b", { action: "close" }, execution.signal,
      async () => { throw new Error("unexpected process launch") })).rejects.toThrow("owner mismatch")
    await browsers.close()
    await expect(browsers.execute(execution, execution.epoch, "topic-a", { action: "close" }, execution.signal,
      async () => { throw new Error("unexpected process launch") })).rejects.toThrow("workspace retired")
  } finally { await scope.close(); control.finish(execution.owner); await browsers.close(); await rm(directory, { recursive: true, force: true }) }
})

test("confirmed browser startup settles its reservation without releasing its service admission", async () => {
  const { TelegramProcessBudgetGovernor } = await import("@opencode-ai/core/telegram-process-budget")
  const MiB = 1024 * 1024
  let used = 400 * MiB
  const governor = new TelegramProcessBudgetGovernor(4, () => ({ memoryUsedBytes: used,
    memoryLimitBytes: 1_000_000_000, memoryPressure: used / 1_000_000_000 }), () => true)
  const browser = governor.acquire("browser", undefined, "browser")!
  used = 600 * MiB // actual full daemon/Chromium startup is now accounted
  expect(() => governor.acquire("node", undefined, "browser-client")).toThrow("ceiling=95.0%")
  browser.settleStartup!()
  expect(governor.snapshot().activeCount).toBe(1)
  const client = governor.acquire("node", undefined, "browser-client")!
  expect(governor.snapshot().activeCount).toBe(2)
  client.release()
  expect(governor.snapshot().activeCount).toBe(1)
  browser.release()
})
