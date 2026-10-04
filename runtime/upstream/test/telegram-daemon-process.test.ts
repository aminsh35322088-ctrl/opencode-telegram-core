import { afterEach, beforeEach, expect, test, spyOn } from "bun:test"
import { readFile } from "node:fs/promises"
import { ownServiceProcess } from "@opencode-ai/core/telegram-service-process"
import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { once } from "node:events"
import { spawn as launchLsp } from "../../src/lsp/launch"
import { Process } from "../../src/util/process"
import { telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"

const flag = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
beforeEach(() => { process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1" })
afterEach(() => {
  if (flag === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = flag
})
async function exists(pid: number) {
  try { await readFile(`/proc/${pid}/stat`); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
}

test.skipIf(process.platform !== "linux")("LSP stop joins TERM-resistant descendant cleanup before releasing admission", async () => {
  const count = telegramProcessBudgetSnapshot().activeCount
  const proc = launchLsp("/bin/bash", ["-c", "trap '' TERM; sleep 60 & echo $!; wait"])
  const [chunk] = await once(proc.stdout, "data")
  const descendant = Number(chunk.toString().trim())
  try {
    expect(descendant).toBeGreaterThan(0)
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count + 1)
    await Process.stop(proc)
    expect(await exists(proc.pid!)).toBe(false)
    expect(await exists(descendant)).toBe(false)
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
  } finally {
    for (const pid of [proc.pid!, descendant]) {
      try { process.kill(pid, "SIGKILL") } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
    }
    await proc.exited
  }
})

test.skipIf(process.platform !== "linux")("LSP leader exit cleans detached-output descendants before releasing admission", async () => {
  const count = telegramProcessBudgetSnapshot().activeCount
  const proc = launchLsp("/bin/bash", ["-c", "sleep 60 </dev/null >/dev/null 2>&1 & echo $!"])
  const [chunk] = await once(proc.stdout, "data")
  const descendant = Number(chunk.toString().trim())
  try {
    expect(descendant).toBeGreaterThan(0)
    await proc.exited
    expect(await exists(descendant)).toBe(false)
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
  } finally {
    try { process.kill(descendant, "SIGKILL") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
    await proc.exited
  }
})

test.skipIf(process.platform !== "linux")("failed LSP spawn returns admission without a process-group identity", async () => {
  const count = telegramProcessBudgetSnapshot().activeCount
  const proc = launchLsp("/opencode-test-missing-executable", [])
  await expect(proc.exited).rejects.toThrow()
  expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
})

test.skipIf(process.platform !== "linux")("workspace service retirement joins descendants outside its original group", async () => {
  const count = telegramProcessBudgetSnapshot().activeCount
  const script = "import os,time; child=os.fork();\nif child==0:\n os.setsid(); print(os.getpid(),flush=True);\n while True: time.sleep(1)\nwhile True: time.sleep(1)"
  const proc = launchLsp("python3", ["-c", script])
  const [chunk] = await once(proc.stdout, "data")
  const descendant = Number(chunk.toString().trim())
  try {
    expect(descendant).toBeGreaterThan(0)
    await Process.stop(proc)
    expect(await exists(descendant)).toBe(false)
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
  } finally {
    if (await exists(descendant)) process.kill(descendant, "SIGKILL")
    await proc.exited
  }
})

test.skipIf(process.platform !== "linux")("uncertain service cleanup retains admission", async () => {
  const pid = 2147483001
  const proc = Object.assign(new EventEmitter(), { pid }) as ChildProcess
  let releases = 0
  const owned = ownServiceProcess(proc, {
    id: "uncertain", kind: "lsp", admittedAt: Date.now(), bindPid() {}, release() { releases++ },
  })
  proc.emit("spawn")
  const signals = spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("denied"), { code: "EPERM" })
  })
  try {
    await expect(owned.cleanup()).rejects.toThrow("denied")
    expect(releases).toBe(0)
    proc.emit("close")
    await expect(owned.cleanup()).rejects.toThrow("denied")
    expect(releases).toBe(0)
  } finally { signals.mockRestore() }
})

test.skipIf(process.platform !== "linux")("completed service ownership cannot signal a reused group", async () => {
  const pid = 2147483002
  const proc = Object.assign(new EventEmitter(), { pid }) as ChildProcess
  let releases = 0
  const owned = ownServiceProcess(proc, {
    id: "complete", kind: "lsp", admittedAt: Date.now(), bindPid() {}, release() { releases++ },
  })
  proc.emit("spawn")
  proc.emit("close")
  const signals = spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" })
  })
  try {
    await owned.cleanup()
    expect(releases).toBe(1)
    const calls = signals.mock.calls.length
    signals.mockImplementation(() => true)
    await owned.cleanup()
    expect(signals.mock.calls.length).toBe(calls)
    expect(releases).toBe(1)
  } finally { signals.mockRestore() }
})

test.skipIf(process.platform !== "linux")("workspace service cleanup remains bounded when admission is disabled", async () => {
  process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "0"
  const proc = launchLsp("/bin/bash", ["-c", "trap '' TERM; sleep 60 & echo $!; wait"])
  const [chunk] = await once(proc.stdout, "data")
  const descendant = Number(chunk.toString().trim())
  try {
    await Process.stop(proc)
    expect(await exists(proc.pid!)).toBe(false)
    expect(await exists(descendant)).toBe(false)
  } finally {
    for (const pid of [proc.pid!, descendant]) {
      try { process.kill(pid, "SIGKILL") } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
    }
    await proc.exited
  }
})
