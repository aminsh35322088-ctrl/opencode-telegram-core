import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import {
  checkpoint,
  completionCheckpoint,
  CurrentTelegramContinuation,
  CurrentTelegramEpoch,
  CurrentTelegramExecution,
} from "@opencode-ai/core/telegram-execution-context"
import { MessageID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { SessionExecutionFrame, SessionExecutionLease } from "@opencode-ai/core/session-execution-control"
import { Deferred, Effect, Exit, Fiber, Latch } from "effect"
import { Session } from "../../src/session/session"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { BackgroundJob } from "../../src/background/job"
import { testEffect } from "../lib/effect"
import { disposeInstance } from "../../src/effect/instance-registry"
import { TestInstance } from "../fixture/fixture"
import { EffectBridge } from "../../src/effect/bridge"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      CrossSpawnSpawner.node,
      Session.node,
      SessionRunState.node,
      SessionProjector.node,
      BackgroundJob.node,
      SessionStatus.node,
    ]),
  ),
)

it.instance("cancel settles shell readiness when a paused admission never enters the shell body", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const status = yield* SessionStatus.Service
    const session = yield* sessions.create()
    const frame = yield* state.retainTask(session.id)
    yield* state.pause(session.id, frame.execution.owner.runId)
    const ready = yield* Latch.make()
    let entered = false
    const shell = yield* state
      .startShell(
        session.id,
        Effect.never,
        Effect.gen(function* () {
          entered = true
          yield* ready.open
          return yield* Effect.never
        }),
        ready,
      )
      .pipe(Effect.forkChild)
    yield* Effect.gen(function* () {
      while ((yield* status.get(session.id)).type !== "busy") yield* Effect.sleep("1 millis")
    }).pipe(Effect.timeout("1 second"))
    const cancelling = yield* state.cancel(session.id).pipe(Effect.forkChild)
    const settled = yield* Effect.raceFirst(
      ready.await.pipe(Effect.as(true)),
      Effect.sleep("100 millis").pipe(Effect.as(false)),
    )
    // Let a broken implementation unwind too, so its failure cannot hang the suite.
    yield* ready.open
    yield* Fiber.await(cancelling)
    yield* Fiber.await(shell)
    yield* state.releaseTask(frame)
    expect(settled).toBe(true)
    expect(entered).toBe(false)
    expect(yield* state.execution(session.id)).toBeNull()
  }),
)

it.instance("cancel allows existing tool finalization only until the owned runner cleanup ends", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const session = yield* sessions.create()
    const ready = yield* Deferred.make<{ execution: SessionExecutionLease; epoch: number }>()
    let completed = false
    let admitted = false
    const fiber = yield* state
      .ensureRunning(
        session.id,
        Effect.never,
        Effect.gen(function* () {
          const execution = yield* CurrentTelegramExecution
          const epoch = yield* CurrentTelegramEpoch
          if (!execution || epoch === undefined) return yield* Effect.die(new Error("execution context missing"))
          yield* Deferred.succeed(ready, { execution, epoch })
          return yield* Effect.never
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              const admission = yield* checkpoint.pipe(Effect.exit)
              admitted = admission._tag === "Success"
              const completion = yield* completionCheckpoint.pipe(Effect.exit)
              completed = completion._tag === "Success"
            }),
          ),
        ),
        "cleanup-run",
      )
      .pipe(Effect.forkChild)
    const captured = yield* Deferred.await(ready)
    yield* state.cancel(session.id)
    yield* Fiber.interrupt(fiber)
    const late = yield* Effect.promise(() => captured.execution.completionCheckpoint(undefined, captured.epoch)).pipe(
      Effect.exit,
    )
    expect(completed).toBe(true)
    expect(admitted).toBe(false)
    expect(late._tag).toBe("Failure")
  }),
)

it.instance("cancel joins a detached admitted tool before replacement admission and grant revocation", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const session = yield* sessions.create()
    const replacement = yield* sessions.create()
    const ready = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const interrupted = yield* Deferred.make<void>()
    let completed = false
    let admitted = false
    const fiber = yield* state
      .ensureRunning(
        session.id,
        Effect.never,
        Effect.gen(function* () {
          const execution = yield* CurrentTelegramExecution
          const epoch = yield* CurrentTelegramEpoch
          if (!execution || epoch === undefined) return yield* Effect.die(new Error("execution context missing"))
          const bridge = yield* EffectBridge.make()
          void execution
            .trackTool(
              () =>
                bridge.promise(
                  Effect.gen(function* () {
                    yield* Deferred.succeed(ready, undefined)
                    yield* Deferred.await(release)
                    yield* completionCheckpoint
                    completed = true
                  }),
                ),
              epoch,
            )
            .catch(() => {})
          return yield* Effect.never
        }).pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
        "detached-tool-run",
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(ready)
    const cancelling = yield* state.cancel(session.id).pipe(Effect.forkChild)
    yield* Deferred.await(interrupted)
    yield* Effect.sleep("20 millis")
    yield* state
      .ensureRunning(
        replacement.id,
        Effect.never,
        Effect.sync(() => {
          admitted = true
          throw new Error("replacement admitted before tool cleanup")
        }),
        "replacement",
      )
      .pipe(Effect.exit)
    yield* Deferred.succeed(release, undefined)
    const exit = yield* Fiber.await(cancelling)
    yield* Fiber.interrupt(fiber)
    expect(admitted).toBe(false)
    expect(completed).toBe(true)
    expect(exit._tag).toBe("Success")
  }),
)

it.instance(
  "tool cleanup timeout keeps workspace admission fenced",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const state = yield* SessionRunState.Service
      const session = yield* sessions.create()
      const replacement = yield* sessions.create()
      const ready = yield* Deferred.make<SessionExecutionLease>()
      let release!: () => void
      let admitted = false
      const fiber = yield* state
        .ensureRunning(
          session.id,
          Effect.never,
          Effect.gen(function* () {
            const execution = yield* CurrentTelegramExecution
            const epoch = yield* CurrentTelegramEpoch
            if (!execution || epoch === undefined) return yield* Effect.die(new Error("execution context missing"))
            void execution
              .trackTool(
                () =>
                  new Promise<void>((resolve) => {
                    release = resolve
                    Effect.runSync(Deferred.succeed(ready, execution))
                  }),
                epoch,
              )
              .catch(() => {})
            return yield* Effect.never
          }),
          "hung-tool-run",
        )
        .pipe(Effect.forkChild)
      const execution = yield* Deferred.await(ready)
      const cancel = yield* state.cancel(session.id).pipe(Effect.exit)
      yield* state
        .ensureRunning(
          replacement.id,
          Effect.never,
          Effect.sync(() => {
            admitted = true
            throw new Error("replacement admitted after uncertain cleanup")
          }),
        )
        .pipe(Effect.exit)
      release()
      yield* Effect.promise(() => execution.whenToolsSettled())
      yield* Fiber.interrupt(fiber)
      expect(cancel._tag).toBe("Failure")
      expect(admitted).toBe(false)
      const late = yield* Effect.promise(() => execution.completionCheckpoint(undefined, execution.epoch)).pipe(
        Effect.exit,
      )
      expect(late._tag).toBe("Failure")
    }),
  30_000,
)

it.instance("workspace disposal terminates all owned resources even if runner idle cleanup fails", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const test = yield* TestInstance
    const session = yield* sessions.create()
    const ready = yield* Deferred.make<SessionExecutionLease>()
    let terminated = false
    const fiber = yield* state
      .startShell(
        session.id,
        Effect.die(new Error("cancelled")),
        Effect.gen(function* () {
          const execution = yield* CurrentTelegramExecution
          if (!execution) return yield* Effect.die(new Error("execution context missing"))
          execution.attach({
            pause() {},
            resume() {},
            terminate() {
              terminated = true
            },
          })
          yield* Deferred.succeed(ready, execution)
          return yield* Effect.never
        }),
      )
      .pipe(Effect.forkChild)
    const execution = yield* Deferred.await(ready)
    yield* Effect.promise(() => disposeInstance(test.directory))
    expect(terminated).toBe(true)
    expect(execution.signal.aborted).toBe(true)
    yield* Fiber.interrupt(fiber)
  }),
)

it.instance("pause persists intent and resume continues the existing session runner", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const session = yield* sessions.create()
    const ready = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let continued = 0
    const fiber = yield* state
      .ensureRunning(
        session.id,
        Effect.die(new Error("cancelled")),
        Effect.gen(function* () {
          yield* Deferred.succeed(ready, undefined)
          yield* Deferred.await(release)
          yield* checkpoint
          continued += 1
          return yield* Effect.never
        }),
        "run-1",
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(ready)
    expect(yield* state.pause(session.id, "run-1")).toEqual({ runId: "run-1", paused: true, continuation: "live" })
    expect((yield* sessions.get(session.id)).metadata?.telegramExecution).toEqual({ runId: "run-1", paused: true })
    yield* Deferred.succeed(release, undefined)
    yield* Effect.sleep("10 millis")
    expect(continued).toBe(0)
    expect(yield* state.resume(session.id, "run-1")).toEqual({ runId: "run-1", paused: false, continuation: "live" })
    yield* Effect.sleep("10 millis")
    expect(continued).toBe(1)
    yield* state.cancel(session.id)
    yield* Fiber.await(fiber)
    expect(yield* state.execution(session.id)).toBeNull()
  }),
)

it.instance("ordinary completion joins detached tools and resolves the caller", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const session = yield* sessions.create()
    const info = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: session.id,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
      time: { created: Date.now() },
    })
    const result = { info, parts: [] }
    const ready = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let completed = false
    const run = yield* state
      .ensureRunning(
        session.id,
        Effect.succeed(result),
        Effect.gen(function* () {
          const execution = yield* CurrentTelegramExecution
          const epoch = yield* CurrentTelegramEpoch
          if (!execution || epoch === undefined) return yield* Effect.die(new Error("execution context missing"))
          const bridge = yield* EffectBridge.make()
          void execution
            .trackTool(
              () =>
                bridge.promise(
                  Effect.gen(function* () {
                    yield* Deferred.succeed(ready, undefined)
                    yield* Deferred.await(release)
                    completed = true
                  }),
                ),
              epoch,
            )
            .catch(() => {})
          yield* Deferred.await(ready)
          return result
        }),
        "normal-completion",
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(ready)
    yield* Effect.sleep("20 millis")
    yield* Deferred.succeed(release, undefined)
    const settled = yield* Fiber.await(run).pipe(Effect.timeout("1 second"), Effect.exit)
    if (settled._tag === "Failure") yield* state.cancel(session.id).pipe(Effect.exit)
    expect(settled._tag).toBe("Success")
    if (settled._tag === "Success") expect(settled.value._tag).toBe("Success")
    expect(completed).toBe(true)
    expect(yield* state.execution(session.id)).toBeNull()
  }),
)

it.instance("recovered pause cannot recreate a lost continuation", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const session = yield* sessions.create()
    yield* sessions.setMetadata({
      sessionID: session.id,
      metadata: { telegramExecution: { runId: "old-run", paused: true } },
    })
    expect(yield* state.execution(session.id)).toEqual({ runId: "old-run", paused: true, continuation: "unavailable" })
    const resuming = yield* state.resume(session.id, "old-run").pipe(Effect.exit)
    expect(resuming._tag).toBe("Failure")
    let recreated = false
    const admission = yield* state
      .ensureRunning(
        session.id,
        Effect.never,
        Effect.gen(function* () {
          recreated = true
          return yield* Effect.never
        }),
        "new-run",
      )
      .pipe(Effect.exit)
    expect(admission._tag).toBe("Failure")
    expect(recreated).toBe(false)
    yield* state.cancel(session.id)
    expect(yield* state.execution(session.id)).toBeNull()
  }),
)

it.instance("parent cancellation permits a background child's cancellation finalizer to re-enter", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const background = yield* BackgroundJob.Service
    const parent = yield* sessions.create()
    const child = yield* sessions.create({ parentID: parent.id })
    const ready = yield* Deferred.make<void>()
    let finalized = false
    yield* background.start({
      id: child.id,
      type: "task",
      metadata: { sessionId: child.id, parentSessionId: parent.id },
      run: Effect.gen(function* () {
        yield* Deferred.succeed(ready, undefined)
        return yield* Effect.never
      }).pipe(
        Effect.onInterrupt(() =>
          state.cancel(child.id).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                finalized = true
              }),
            ),
          ),
        ),
      ),
    })
    yield* Deferred.await(ready)
    yield* state.cancel(parent.id)
    expect(finalized).toBe(true)
    expect((yield* background.get(child.id))?.status).toBe("cancelled")
  }),
)

it.instance("a child cannot bypass recovered paused ancestor intent", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const parent = yield* sessions.create()
    const child = yield* sessions.create({ parentID: parent.id })
    yield* sessions.setMetadata({
      sessionID: parent.id,
      metadata: { telegramExecution: { runId: "old-parent", paused: true } },
    })
    expect(yield* state.execution(child.id)).toEqual({ runId: "old-parent", paused: true, continuation: "unavailable" })
    let recreated = false
    const admission = yield* state
      .ensureRunning(
        child.id,
        Effect.never,
        Effect.gen(function* () {
          recreated = true
          return yield* Effect.never
        }),
        "new-child",
      )
      .pipe(Effect.exit)
    expect(admission._tag).toBe("Failure")
    expect(recreated).toBe(false)
    yield* state.cancel(parent.id)
  }),
)

it.instance("background completion retains the original parent run and rejects retired callbacks", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const parent = yield* sessions.create()
    const child = yield* sessions.create({ parentID: parent.id })
    const info = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: parent.id,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
      time: { created: Date.now() },
    })
    const result = { info, parts: [] }
    const setup = yield* Deferred.make<{
      frame: SessionExecutionFrame
      parent: SessionExecutionLease
      epoch: number | undefined
    }>()
    yield* state.ensureRunning(
      parent.id,
      Effect.succeed(result),
      Effect.gen(function* () {
        const execution = yield* CurrentTelegramExecution
        if (!execution) return yield* Effect.die(new Error("execution context missing"))
        const frame = yield* state.retainTask(child.id)
        yield* Deferred.succeed(setup, { frame, parent: execution, epoch: yield* CurrentTelegramEpoch })
        return result
      }),
      "original-parent",
    )
    const captured = yield* Deferred.await(setup)
    expect((yield* state.execution(parent.id))?.runId).toBe("original-parent")
    yield* state
      .ensureRunning(
        child.id,
        Effect.succeed(result),
        Effect.succeed(result).pipe(Effect.provideService(CurrentTelegramExecution, captured.frame.execution)),
      )
      .pipe(
        Effect.provideService(CurrentTelegramExecution, captured.frame.execution),
        Effect.provideService(CurrentTelegramContinuation, {
          frame: captured.frame,
          owner: captured.frame.execution.owner,
        }),
      )
    expect((yield* state.execution(parent.id))?.runId).toBe("original-parent")
    yield* state
      .ensureRunning(
        parent.id,
        Effect.succeed(result),
        Effect.gen(function* () {
          expect(yield* CurrentTelegramContinuation).toBeUndefined()
          const stale = yield* checkpoint.pipe(Effect.provideService(CurrentTelegramEpoch, captured.epoch), Effect.exit)
          expect(stale._tag).toBe("Failure")
          expect(yield* CurrentTelegramEpoch).not.toBe(captured.epoch)
          const update = yield* state.retainTask(child.id)
          yield* state
            .ensureRunning(child.id, Effect.succeed(result), Effect.succeed(result))
            .pipe(
              Effect.provideService(CurrentTelegramExecution, update.execution),
              Effect.provideService(CurrentTelegramEpoch, undefined),
              Effect.provideService(CurrentTelegramContinuation, { frame: update, owner: update.execution.owner }),
            )
          yield* state.releaseTask(update)
          return result
        }),
        "original-parent",
      )
      .pipe(
        Effect.provideService(CurrentTelegramExecution, captured.parent),
        Effect.provideService(CurrentTelegramContinuation, { frame: captured.frame, owner: captured.parent.owner }),
      )
    yield* state.releaseTask(captured.frame)
    expect(yield* state.execution(parent.id)).toBeNull()
    let recreated = false
    const stale = yield* state
      .ensureRunning(
        parent.id,
        Effect.succeed(result),
        Effect.sync(() => {
          recreated = true
          return result
        }),
      )
      .pipe(Effect.provideService(CurrentTelegramExecution, captured.parent), Effect.exit)
    expect(stale._tag).toBe("Failure")
    expect(recreated).toBe(false)
  }),
)

it.instance("manual shell pause resumes the same process and cancellation joins its stopped group", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const { ChildProcess, ChildProcessSpawner } = yield* Effect.promise(() => import("effect/unstable/process"))
  const { readFile } = yield* Effect.promise(() => import("node:fs/promises"))
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const session = yield* sessions.create()
  const ready = yield* Deferred.make<number>()
  const latch = yield* Latch.make()
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const previous = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  yield* Effect.acquireUseRelease(
    Effect.sync(() => { process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1" }),
    () => Effect.gen(function* () {
      const fiber = yield* state.startShell(session.id, Effect.die(new Error("cancelled shell")), Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make("/bin/bash", ["-c", "trap '' TERM; sleep 60"], {
          stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true,
        }))
        yield* Deferred.succeed(ready, Number(handle.pid))
        yield* latch.open
        return yield* Effect.never
      }).pipe(Effect.scoped, Effect.orDie), latch, "manual-pause-run").pipe(Effect.forkChild)
      const pid = yield* Deferred.await(ready)
      expect(yield* state.pause(session.id, "manual-pause-run")).toEqual({ runId: "manual-pause-run", paused: true, continuation: "live" })
      const waitState = (paused: boolean) => Effect.promise(async () => {
        const end = Date.now() + 1000
        while (((await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]!.split(" ")[0] === "T") !== paused) {
          if (Date.now() >= end) throw new Error("manual shell state did not settle")
          await Bun.sleep(5)
        }
      })
      yield* waitState(true)
      expect(yield* state.resume(session.id, "manual-pause-run")).toEqual({ runId: "manual-pause-run", paused: false, continuation: "live" })
      yield* waitState(false)
      yield* state.pause(session.id, "manual-pause-run")
      yield* state.cancel(session.id)
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
      expect(yield* state.execution(session.id)).toBeNull()
      expect(() => process.kill(pid, 0)).toThrow()
    }),
    () => Effect.sync(() => {
      if (previous === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
      else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = previous
    }),
  )
}))
