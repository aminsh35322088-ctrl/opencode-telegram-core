import { expect, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"
import * as childProcess from "node:child_process"
import nodeChildProcess from "node:child_process"
import { PassThrough } from "node:stream"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"

async function withProcess(
  body: (proc: childProcess.ChildProcess) => Promise<void>,
  signal: (proc: childProcess.ChildProcess) => void = () => {},
  governed = false,
) {
  const previousBudget = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = governed ? "1" : "0"
  const proc = Object.assign(new EventEmitter(), {
    pid: 2147483647,
    stdin: null,
    stdout: null,
    stderr: null,
    stdio: [null, null, null],
    kill: () => false,
  }) as unknown as childProcess.ChildProcess
  const spawning = spyOn(nodeChildProcess, "spawn").mockImplementation((() => {
    queueMicrotask(() => proc.emit("spawn"))
    return proc
  }) as typeof childProcess.spawn)
  const originalKill = process.kill
  const killing = spyOn(process, "kill").mockImplementation((pid, value) => {
    if (value === 0) {
      if (pid === proc.pid) throw Object.assign(new Error("synthetic process has exited"), { code: "ESRCH" })
      return originalKill(pid, value)
    }
    signal(proc)
    return true
  })
  const exec = spyOn(childProcess, "exec").mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void
    queueMicrotask(() => {
      try { signal(proc); callback(null, "", "") }
      catch (error) { callback(error instanceof Error ? error : new Error(String(error)), "", "") }
    })
    return proc
  }) as typeof childProcess.exec)
  // Let the original unbounded implementation settle so the red test cleans up.
  const rescue = setTimeout(() => proc.emit("close", null, "SIGKILL"), 7000)
  try {
    await body(proc)
    expect(spawning.mock.calls.length).toBe(1)
  } finally {
    clearTimeout(rescue)
    proc.emit("close", null, "SIGKILL")
    spawning.mockRestore()
    killing.mockRestore()
    exec.mockRestore()
    if (previousBudget === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
    else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = previousBudget
  }
}

const release = () => Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  yield* spawner.spawn(ChildProcess.make("synthetic-process", [], {
    stdin: "ignore", stdout: "ignore", stderr: "ignore", forceKillAfter: "10 millis",
  }))
}).pipe(Effect.scoped, Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.runPromiseExit)

test("missing close fails within the cleanup deadline and retains governor admission", async () => {
  await withProcess(async (proc) => {
    const baseline = telegramProcessBudgetSnapshot().activeCount
    const exit = await release()
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("process close deadline exceeded")
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(baseline + 1)
    proc.emit("error", new Error("synthetic post-spawn notification error"))
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(baseline + 1)
    proc.emit("close", null, "SIGKILL")
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(baseline)
  }, () => {}, true)
}, 10000)

test("explicit process kill uses the same bounded terminal wait", async () => {
  await withProcess(async (proc) => {
    const exit = await Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make("synthetic-process", [], {
        stdin: "ignore", stdout: "ignore", stderr: "ignore",
      }))
      const killed = yield* handle.kill({ forceKillAfter: "10 millis" }).pipe(Effect.exit)
      // Retire the synthetic resource before the enclosing scope releases it.
      proc.emit("close", null, "SIGKILL")
      return killed
    }).pipe(Effect.scoped, Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.runPromise)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("process close deadline exceeded")
  })
}, 10000)

test("exit notification preserves trailing output and does not complete exitCode before close", async () => {
  await withProcess(async (proc) => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    Object.assign(proc, { stdout, stderr, stdio: [null, stdout, stderr] })
    try {
      await Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const handle = yield* spawner.spawn(ChildProcess.make("synthetic-process", [], { stdin: "ignore" }))
        const output = yield* Stream.runCollect(Stream.decodeText(handle.stdout)).pipe(Effect.forkChild)
        const code = yield* handle.exitCode.pipe(Effect.forkChild)
        proc.emit("exit", 0, null)
        yield* Effect.sleep("10 millis")
        expect(code.pollUnsafe()).toBeUndefined()
        stdout.end("trailing output")
        stderr.end()
        proc.emit("close", 0, null)
        expect((yield* Fiber.join(output)).join("")).toBe("trailing output")
        expect(yield* Fiber.join(code)).toBe(ChildProcessSpawner.ExitCode(0))
      }).pipe(Effect.scoped, Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.runPromise)
    } finally {
      stdout.destroy()
      stderr.destroy()
    }
  })
}, 10000)

test("failed TERM delivery still escalates and joins the close notification", async () => {
  let signals = 0
  await withProcess(async () => {
    expect(Exit.isSuccess(await release())).toBe(true)
    expect(signals).toBe(2)
  }, (proc) => {
    if (++signals === 1) throw new Error("signal delivery raced with exit")
    queueMicrotask(() => proc.emit("close", null, "SIGKILL"))
  })
}, 10000)
