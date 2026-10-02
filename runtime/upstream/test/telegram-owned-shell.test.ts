import { afterEach, beforeEach, expect, test, spyOn } from "bun:test"
import { EventEmitter } from "node:events"
import nodeChildProcess from "node:child_process"
import type { ChildProcess as NodeChildProcess } from "node:child_process"
import { ownShellProcess } from "@opencode-ai/core/telegram-owned-process"
import { readFile } from "node:fs/promises"
import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import { CurrentTelegramExecution, CurrentTelegramEpoch } from "@opencode-ai/core/telegram-execution-context"
import { telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"

const linux = test.skipIf(process.platform !== "linux")
const budgetFlag = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
beforeEach(() => { process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1" })
afterEach(() => {
  if (budgetFlag === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = budgetFlag
})

async function state(pid: number): Promise<string | null> {
  try { return (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]!.split(" ")[0]! }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error }
}
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 1000
  while (!(await check())) {
    if (Date.now() >= end) throw new Error("process state did not reach the expected condition")
    await Bun.sleep(5)
  }
}

linux("parent pause stops the shell group; resume retains its PID; abort after pause joins cleanup", async () => {
  const count = telegramProcessBudgetSnapshot().activeCount
  const control = new SessionExecutionControl()
  const parent = control.start({ sessionId: "parent", runId: "parent-run", directory: process.cwd() })
  const child = control.start({ sessionId: "child", runId: "child-run", directory: process.cwd() }, parent.owner)
  await Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make("/bin/bash", ["-c", "trap '' TERM; sleep 60 & echo $!; wait"], {
      stdin: "ignore", detached: true,
    }))
    const chunks = yield* Stream.runCollect(handle.stdout.pipe(Stream.take(1)))
    const descendant = Number(Buffer.concat([...chunks]).toString().trim())
    yield* Effect.promise(async () => {
      try {
        expect(descendant).toBeGreaterThan(0)
        control.pause(parent.owner)
        await until(async () => await state(Number(handle.pid)) === "T" && await state(descendant) === "T")
        expect(telegramProcessBudgetSnapshot().activeCount).toBe(count + 1)
        control.resume(parent.owner)
        await until(async () => await state(Number(handle.pid)) !== "T" && await state(descendant) !== "T")
        expect(await state(Number(handle.pid))).not.toBeNull()
        control.pause(parent.owner)
        control.close(parent.owner)
        await until(async () => await state(Number(handle.pid)) === null && await state(descendant) === null)
      } finally {
        if (control.get(parent.owner)) control.close(parent.owner)
        // Keep a red regression from leaving its deliberately long-lived child.
        await Effect.runPromise(handle.kill({ killSignal: "SIGKILL", forceKillAfter: "20 millis" }))
      }
    })
  }).pipe(
    Effect.scoped,
    Effect.provideService(CurrentTelegramExecution, child),
    Effect.provideService(CurrentTelegramEpoch, child.epoch),
    Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
    Effect.runPromise,
  )
  expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
})

linux("normal shell leader exit cleans descendants before releasing admission", async () => {
  const count = telegramProcessBudgetSnapshot().activeCount
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "session", runId: "run", directory: process.cwd() })
  let descendant = 0
  await Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const handle = yield* spawner.spawn(ChildProcess.make("/bin/bash", ["-c", "sleep 60 </dev/null >/dev/null 2>&1 & echo $!"], {
      stdin: "ignore", detached: true,
    }))
    const chunks = yield* Stream.runCollect(handle.stdout)
    descendant = Number(Buffer.concat([...chunks]).toString().trim())
    yield* handle.exitCode
  }).pipe(
    Effect.scoped,
    Effect.provideService(CurrentTelegramExecution, execution),
    Effect.provideService(CurrentTelegramEpoch, execution.epoch),
    Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)),
    Effect.runPromise,
  )
  try {
    expect(descendant).toBeGreaterThan(0)
    expect(await state(descendant)).toBeNull()
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
    // A completed OS identity cannot regain signal authority on later controls.
    control.pause(execution.owner)
    control.resume(execution.owner)
  } finally {
    if (control.get(execution.owner)) control.close(execution.owner)
    if (await state(descendant)) process.kill(descendant, "SIGKILL")
  }
})

linux("completed shell ownership cannot signal a reused process-group identity", async () => {
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "session", runId: "run", directory: process.cwd() })
  const pid = 2147483000
  let replacement = false
  let releases = 0
  const signals = spyOn(process, "kill").mockImplementation((target, signal) => {
    if (target !== -pid) throw new Error("unexpected process identity")
    if (signal === 0 && !replacement) throw Object.assign(new Error("gone"), { code: "ESRCH" })
    return true
  })
  try {
    const owned = ownShellProcess({ pid } as NodeChildProcess, execution, execution.epoch, {
      id: "test", kind: "shell", admittedAt: Date.now(), bindPid() {}, release() { releases++ },
    })
    owned.attach()
    owned.closed()
    await owned.cleanup()
    expect(releases).toBe(1)
    const calls = signals.mock.calls.length
    replacement = true
    control.pause(execution.owner)
    control.resume(execution.owner)
    control.close(execution.owner)
    expect(signals.mock.calls.length).toBe(calls)
  } finally {
    if (control.get(execution.owner)) control.close(execution.owner)
    signals.mockRestore()
  }
})

linux("retained shell handles cannot kill a reused process group after scope cleanup", async () => {
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "session", runId: "run", directory: process.cwd() })
  const pid = 2147483100
  const proc = Object.assign(new EventEmitter(), {
    pid, stdin: null, stdout: null, stderr: null, stdio: [null, null, null],
    exitCode: null, signalCode: null, kill: () => true,
  }) as unknown as NodeChildProcess
  let replacement = false
  const launching = spyOn(nodeChildProcess, "spawn").mockImplementation((() => {
    queueMicrotask(() => proc.emit("spawn"))
    return proc
  }) as typeof nodeChildProcess.spawn)
  const signals = spyOn(process, "kill").mockImplementation((target, signal) => {
    if (target !== -pid) throw new Error("unexpected identity")
    if (signal === 0 && !replacement) throw Object.assign(new Error("gone"), { code: "ESRCH" })
    return true
  })
  try {
    const handle = await Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make("/bin/bash", [], { detached: true }))
      proc.emit("exit", 0, null)
      proc.emit("close", 0, null)
      yield* handle.exitCode
      return handle
    }).pipe(
      Effect.scoped, Effect.provideService(CurrentTelegramExecution, execution),
      Effect.provideService(CurrentTelegramEpoch, execution.epoch),
      Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.runPromise,
    )
    const calls = signals.mock.calls.length
    replacement = true
    await Effect.runPromise(handle.kill())
    expect(signals.mock.calls.length).toBe(calls)
  } finally {
    control.close(execution.owner)
    launching.mockRestore()
    signals.mockRestore()
  }
})

linux("failed paused attachment returns resource cleanup to the caller", () => {
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "session", runId: "run", directory: process.cwd() })
  let terminations = 0
  const resource = {
    pause: () => { throw new Error("SIGSTOP denied") }, resume() {},
    terminate: () => { terminations++ },
  }
  control.pause(execution.owner)
  expect(() => execution.attach(resource)).toThrow("SIGSTOP denied")
  resource.terminate() // The failed caller still owns cleanup, without a remover.
  control.close(execution.owner)
  expect(terminations).toBe(1)
})
