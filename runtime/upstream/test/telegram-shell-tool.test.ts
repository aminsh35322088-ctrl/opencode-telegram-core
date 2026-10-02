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
