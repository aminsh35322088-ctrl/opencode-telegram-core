import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Sink, Stream } from "effect"
import * as ProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import { CurrentTelegramExecution } from "@opencode-ai/core/telegram-execution-context"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { ShellTool } from "../../src/tool/shell"
import { Truncate } from "../../src/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([
  CrossSpawnSpawner.node, FSUtil.node, Plugin.node, Truncate.node,
  Config.node, Agent.node, RuntimeFlags.node,
])))

it.instance("the shell timeout counts active time while its parent is paused", () => Effect.gen(function* () {
  const instance = yield* TestInstance
  const control = new SessionExecutionControl()
  const parent = control.start({ sessionId: "parent", runId: "parent-run", directory: instance.directory })
  const execution = control.start({ sessionId: "child", runId: "child-run", directory: instance.directory }, parent.owner)
  const spawned = Deferred.makeUnsafe<void>()
  let kills = 0
  // Keep the OS boundary pending deterministically; exercise the real ShellTool
  // timeout/race/kill path with the authoritative parent/child execution tree.
  const spawner = ProcessSpawner.make(() => Effect.gen(function* () {
    yield* Deferred.succeed(spawned, undefined)
    return ProcessSpawner.makeHandle({
      pid: ProcessSpawner.ProcessId(1),
      exitCode: Effect.never,
      isRunning: Effect.succeed(true),
      kill: () => Effect.sync(() => { kills += 1 }),
      stdin: Sink.drain,
      stdout: Stream.empty, stderr: Stream.empty, all: Stream.empty,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: Effect.succeed(Effect.void),
    })
  }))
  const work = Effect.gen(function* () {
    const tool = yield* ShellTool
    const initialized = yield* tool.init()
    return yield* initialized.execute({ command: "echo pending", timeout: 40 }, {
      sessionID: SessionID.make("ses_shell_pause"), messageID: MessageID.make("msg_shell_pause"),
      agent: "build", abort: execution.signal, messages: [],
      metadata: () => Effect.void, ask: () => Effect.void,
    })
  }).pipe(
    Effect.provideService(ProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(CurrentTelegramExecution, execution),
  )
  const fiber = yield* work.pipe(Effect.forkChild)
  yield* Deferred.await(spawned)
  control.pause(parent.owner)
  yield* Effect.sleep("250 millis")
  const killedWhilePaused = kills
  control.resume(parent.owner)
  const result = yield* Fiber.join(fiber)
  control.close(parent.owner)
  expect(killedWhilePaused).toBe(0)
  expect(kills).toBe(1)
  expect(result.output).toContain("exceeding timeout 40 ms")
}))

it.instance("actual ShellTool abort after parent pause terminates the same owned shell", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const instance = yield* TestInstance
  const control = new SessionExecutionControl()
  const parent = control.start({ sessionId: "parent", runId: "pause-parent", directory: instance.directory })
  const execution = control.start({ sessionId: "child", runId: "pause-tool", directory: instance.directory }, parent.owner)
  const marker = `${instance.directory}/actual-shell-pid`
  const spawner = yield* ProcessSpawner.ChildProcessSpawner
  const spawned = Deferred.makeUnsafe<number>()
  const observing = ProcessSpawner.make((command) => spawner.spawn(command).pipe(
    Effect.tap((handle) => Deferred.succeed(spawned, Number(handle.pid))),
  ))
  const previous = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  yield* Effect.acquireUseRelease(
    Effect.sync(() => { process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1" }),
    () => Effect.gen(function* () {
      const work = Effect.gen(function* () {
        const initialized = yield* (yield* ShellTool).init()
        return yield* initialized.execute({ command: `printf '%s' "$$" > '${marker.replaceAll("'", "'\\''")}'; trap '' TERM; sleep 60`, timeout: 10_000 }, {
          sessionID: SessionID.make("ses_shell_abort_pause"), messageID: MessageID.make("msg_shell_abort_pause"),
          agent: "build", abort: execution.signal, messages: [],
          metadata: () => Effect.void, ask: () => Effect.void,
        })
      }).pipe(
        Effect.provideService(ProcessSpawner.ChildProcessSpawner, observing),
        Effect.provideService(CurrentTelegramExecution, execution),
      )
      const fiber = yield* work.pipe(Effect.forkChild)
      yield* Deferred.await(spawned)
      const pid = yield* Effect.promise(async () => {
        const { readFile } = await import("node:fs/promises")
        const end = Date.now() + 1000
        for (;;) {
          try { return Number(await readFile(marker, "utf8")) } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" || Date.now() >= end) throw error
            await Bun.sleep(5)
          }
        }
      })
      control.pause(parent.owner)
      yield* Effect.promise(async () => {
        const { readFile } = await import("node:fs/promises")
        const end = Date.now() + 1000
        while ((await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]!.split(" ")[0] !== "T") {
          if (Date.now() >= end) throw new Error("actual ShellTool process did not stop")
          await Bun.sleep(5)
        }
      })
      control.close(parent.owner)
      const result = yield* Fiber.join(fiber)
      expect(result.output).toContain("User aborted the command")
      expect(() => process.kill(pid, 0)).toThrow()
    }),
    () => Effect.sync(() => {
      if (control.get(parent.owner)) control.close(parent.owner)
      if (previous === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
      else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = previous
    }),
  )
}))
