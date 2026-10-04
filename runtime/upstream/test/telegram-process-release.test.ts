import { expect, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"
import * as childProcess from "node:child_process"
import nodeChildProcess from "node:child_process"
import { PassThrough } from "node:stream"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Shell } from "@opencode-ai/core/shell"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ownServiceProcess } from "@opencode-ai/core/telegram-service-process"

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
  // The governed OS boundary is now the scoped runner, not cross-spawn's raw
  // launcher. Exercise joined ownership directly without accidentally launching
  // a real runner around the synthetic executable.
  const proc = Object.assign(new EventEmitter(), { pid: 2147483647 }) as childProcess.ChildProcess
  let admission = 1
  const owned = ownServiceProcess(proc, {
    id: "missing-close", kind: "helper", admittedAt: Date.now(), bindPid() {}, release() { admission-- },
  })
  const originalKill = process.kill
  const killing = spyOn(process, "kill").mockImplementation((pid, value) => {
    if (pid !== -proc.pid!) return originalKill(pid, value)
    if (value === 0) throw Object.assign(new Error("synthetic group is empty"), { code: "ESRCH" })
    return true
  })
  try {
    proc.emit("spawn")
    await expect(owned.cleanup()).rejects.toThrow("workspace service process group cleanup exceeded 5000ms deadline")
    expect(admission).toBe(1)
    proc.emit("error", new Error("synthetic post-spawn notification error"))
    expect(admission).toBe(1)
    proc.emit("close", null, "SIGKILL")
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(admission).toBe(0) // confirmed late death can release accounting
    await expect(owned.cleanup()).rejects.toThrow() // uncertainty stays fenced
  } finally { proc.emit("close"); killing.mockRestore() }
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

test("interruption while acquiring an output reader removes listeners and closes the pipe", async () => {
  await withProcess(async (proc) => {
    const stdout = new PassThrough()
    Object.assign(proc, { stdout, stdio: [null, stdout, null] })
    const once = stdout.once
    let interrupted = false
    const attaching = spyOn(stdout, "once").mockImplementation(function (this: PassThrough, event, listener) {
      const result = once.call(this, event, listener)
      if (event === "end" && !interrupted) {
        interrupted = true
        Fiber.getCurrent()!.interruptUnsafe()
      }
      return result
    })
    try {
      const exit = await Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const handle = yield* spawner.spawn(ChildProcess.make("synthetic-process", [], { stdin: "ignore" }))
        yield* Stream.runDrain(handle.stdout)
      }).pipe(Effect.scoped, Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.runPromiseExit)
      expect(interrupted).toBe(true)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(stdout.listenerCount("readable")).toBe(0)
      expect(stdout.listenerCount("end")).toBe(0)
      expect(stdout.destroyed).toBe(true)
    } finally {
      attaching.mockRestore()
      stdout.destroy()
    }
  }, proc => { queueMicrotask(() => proc.emit("close", null, "SIGTERM")) })
}, 10000)


test.skipIf(process.platform !== "linux")("Linux shell cancellation during merged output admission joins close", async () => {
  const original = nodeChildProcess.spawn
  let spawned: () => void = () => {}
  let closed = false
  const spawning = spyOn(nodeChildProcess, "spawn").mockImplementation(((...args: Parameters<typeof nodeChildProcess.spawn>) => {
    const proc = Reflect.apply(original, nodeChildProcess, args) as childProcess.ChildProcess
    proc.once("spawn", () => spawned())
    proc.once("close", () => { closed = true })
    return proc
  }) as typeof nodeChildProcess.spawn)
  try {
    for (let round = 0; round < 50; round++) {
      closed = false
      const ready = new Promise<void>(resolve => { spawned = resolve })
      const shell = Shell.preferred()
      const exit = await Effect.gen(function* () {
        const run = yield* Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
          const handle = yield* spawner.spawn(ChildProcess.make(shell, Shell.args(shell, "sleep 30", process.cwd()), {
            stdin: "ignore", forceKillAfter: "10 millis",
          }))
          yield* Stream.runDrain(handle.all)
        }).pipe(Effect.scoped, Effect.forkChild)
        yield* Effect.promise(() => ready)
        yield* Fiber.interrupt(run)
        return yield* Fiber.await(run)
      }).pipe(Effect.scoped, Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)), Effect.runPromise)
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(closed).toBe(true)
    }
  } finally {
    spawning.mockRestore()
  }
}, 30000)
