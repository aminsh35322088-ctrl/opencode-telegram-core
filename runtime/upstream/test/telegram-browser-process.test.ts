import { createWriteStream } from "node:fs"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm, mkdir, writeFile, symlink, rename } from "node:fs/promises"
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
    await expect(browsers.execute(execution, execution.epoch, "topic-b", { action: "close" }, execution.signal)).rejects.toThrow("owner mismatch")
    await browsers.close()
    await expect(browsers.execute(execution, execution.epoch, "topic-a", { action: "close" }, execution.signal)).rejects.toThrow("workspace retired")
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
  expect(() => governor.acquire("node", undefined, "helper")).toThrow("ceiling=95.0%")
  browser.settleStartup!()
  expect(governor.snapshot().activeCount).toBe(1)
  const client = governor.acquire("node", undefined, "helper")!
  expect(governor.snapshot().activeCount).toBe(2)
  client.release()
  expect(governor.snapshot().activeCount).toBe(1)
  browser.release()
})


test.skipIf(process.platform !== "linux")("pause during browser preparation prevents native process admission", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "browser-prepare-pause-")))
  const previousPath = process.env.PATH, previousBudget = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  const { telegramProcessBudgetSnapshot } = await import("@opencode-ai/core/telegram-process-budget")
  await mkdir(path.join(directory, "bin"))
  await mkdir(path.join(directory, "node_modules/playwright-core"), { recursive: true })
  const metadata = JSON.stringify({ name: "@playwright/cli", version: "0.1.18" })
  await writeFile(path.join(directory, "ready-package.json"), metadata)
  execFileSync("mkfifo", [path.join(directory, "package.json")])
  await writeFile(path.join(directory, "node_modules/playwright-core/package.json"), JSON.stringify({ version: "1.63.0-alpha-2026-08-05" }))
  await writeFile(path.join(directory, "cli.js"), "#!/bin/sh\nsleep 60\n", { mode: 0o755 })
  await symlink(path.join(directory, "cli.js"), path.join(directory, "bin/playwright-cli"))
  await symlink(path.join(directory, "cli.js"), path.join(directory, "bin/node"))
  process.env.PATH = path.join(directory, "bin") + path.delimiter + previousPath
  process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1"
  const baseline = telegramProcessBudgetSnapshot().activeCount
  // Opening the writer proves Core has opened this FIFO for its metadata read.
  // Replace the pathname before releasing bytes so later package resolution sees
  // an ordinary immutable fixture; the current reader retains the original FD.
  const writer = createWriteStream(path.join(directory, "package.json"))
  const preparation = once(writer, "open")
  const browsers = new WorkspaceBrowsers(directory, () => {})
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "topic-a", runId: "prepare", directory })
  const scope = createToolProcessScope(execution, execution.epoch, "topic-a", directory, new AbortController().signal, browsers)
  const request = scope.port.browser({ action: "open" })
  let terminal: unknown
  void request.then(() => terminal = "resolved", error => terminal = error)
  try {
    await Promise.race([preparation, request.then(() => { throw new Error("preparation bypassed") })])
    control.pause(execution.owner)
    await rename(path.join(directory, "ready-package.json"), path.join(directory, "package.json"))
    writer.end(metadata)
    await Bun.sleep(100)
    expect(terminal).toBeUndefined()
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(baseline)
    control.close(execution.owner)
    await expect(request).rejects.toThrow()
    await scope.close()
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(baseline)
  } finally {
    writer.end(metadata); if (control.get(execution.owner)) control.close(execution.owner)
    await scope.close(); await browsers.close(); writer.destroy()
    process.env.PATH = previousPath
    if (previousBudget === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
    else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = previousBudget
    await rm(directory, { recursive: true, force: true })
  }
}, 10000)
