import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { checkpoint, CurrentTelegramContinuation, CurrentTelegramEpoch, CurrentTelegramExecution } from "@opencode-ai/core/telegram-execution-context"
import { MessageID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { SessionExecutionFrame, SessionExecutionLease } from "@opencode-ai/core/session-execution-control"
import { Deferred, Effect, Fiber } from "effect"
import { Session } from "../../src/session/session"
import { SessionRunState } from "../../src/session/run-state"
import { BackgroundJob } from "../../src/background/job"
import { testEffect } from "../lib/effect"
import { disposeInstance } from "../../src/effect/instance-registry"
import { TestInstance } from "../fixture/fixture"

const it = testEffect(LayerNode.compile(LayerNode.group([Session.node, SessionRunState.node, SessionProjector.node, BackgroundJob.node])))

it.instance("workspace disposal terminates all owned resources even if runner idle cleanup fails", () => Effect.gen(function* () {
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const test = yield* TestInstance
  const session = yield* sessions.create()
  const ready = yield* Deferred.make<SessionExecutionLease>()
  let terminated = false
  const fiber = yield* state.startShell(session.id, Effect.die(new Error("cancelled")), Effect.gen(function* () {
    const execution = yield* CurrentTelegramExecution
    if (!execution) return yield* Effect.die(new Error("execution context missing"))
    execution.attach({ pause() {}, resume() {}, terminate() { terminated = true } })
    yield* Deferred.succeed(ready, execution)
    return yield* Effect.never
  })).pipe(Effect.forkChild)
  const execution = yield* Deferred.await(ready)
  yield* Effect.promise(() => disposeInstance(test.directory))
  expect(terminated).toBe(true)
  expect(execution.signal.aborted).toBe(true)
  yield* Fiber.interrupt(fiber)
}))

it.instance("pause persists intent and resume continues the existing session runner", () => Effect.gen(function* () {
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const session = yield* sessions.create()
  const ready = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  let continued = 0
  const fiber = yield* state.ensureRunning(session.id, Effect.die(new Error("cancelled")), Effect.gen(function* () {
    yield* Deferred.succeed(ready, undefined)
    yield* Deferred.await(release)
    yield* checkpoint
    continued += 1
    return yield* Effect.never
  }), "run-1").pipe(Effect.forkChild)
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
}))

it.instance("recovered pause cannot recreate a lost continuation", () => Effect.gen(function* () {
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const session = yield* sessions.create()
  yield* sessions.setMetadata({ sessionID: session.id, metadata: { telegramExecution: { runId: "old-run", paused: true } } })
  expect(yield* state.execution(session.id)).toEqual({ runId: "old-run", paused: true, continuation: "unavailable" })
  const resuming = yield* state.resume(session.id, "old-run").pipe(Effect.exit)
  expect(resuming._tag).toBe("Failure")
  let recreated = false
  const admission = yield* state.ensureRunning(session.id, Effect.never, Effect.gen(function* () {
    recreated = true
    return yield* Effect.never
  }), "new-run").pipe(Effect.exit)
  expect(admission._tag).toBe("Failure")
  expect(recreated).toBe(false)
  yield* state.cancel(session.id)
  expect(yield* state.execution(session.id)).toBeNull()
}))

it.instance("parent cancellation permits a background child's cancellation finalizer to re-enter", () => Effect.gen(function* () {
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const background = yield* BackgroundJob.Service
  const parent = yield* sessions.create()
  const child = yield* sessions.create({ parentID: parent.id })
  const ready = yield* Deferred.make<void>()
  let finalized = false
  yield* background.start({ id: child.id, type: "task", metadata: { sessionId: child.id, parentSessionId: parent.id },
    run: Effect.gen(function* () { yield* Deferred.succeed(ready, undefined); return yield* Effect.never }).pipe(
      Effect.onInterrupt(() => state.cancel(child.id).pipe(Effect.tap(() => Effect.sync(() => { finalized = true })))),
    ),
  })
  yield* Deferred.await(ready)
  yield* state.cancel(parent.id)
  expect(finalized).toBe(true)
  expect((yield* background.get(child.id))?.status).toBe("cancelled")
}))

it.instance("a child cannot bypass recovered paused ancestor intent", () => Effect.gen(function* () {
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const parent = yield* sessions.create()
  const child = yield* sessions.create({ parentID: parent.id })
  yield* sessions.setMetadata({ sessionID: parent.id, metadata: { telegramExecution: { runId: "old-parent", paused: true } } })
  expect(yield* state.execution(child.id)).toEqual({ runId: "old-parent", paused: true, continuation: "unavailable" })
  let recreated = false
  const admission = yield* state.ensureRunning(child.id, Effect.never, Effect.gen(function* () {
    recreated = true
    return yield* Effect.never
  }), "new-child").pipe(Effect.exit)
  expect(admission._tag).toBe("Failure")
  expect(recreated).toBe(false)
  yield* state.cancel(parent.id)
}))

it.instance("background completion retains the original parent run and rejects retired callbacks", () => Effect.gen(function* () {
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const parent = yield* sessions.create()
  const child = yield* sessions.create({ parentID: parent.id })
  const info = yield* sessions.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: parent.id,
    agent: "build", model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
    time: { created: Date.now() } })
  const result = { info, parts: [] }
  const setup = yield* Deferred.make<{
    frame: SessionExecutionFrame
    parent: SessionExecutionLease
    epoch: number | undefined
  }>()
  yield* state.ensureRunning(parent.id, Effect.succeed(result), Effect.gen(function* () {
    const execution = yield* CurrentTelegramExecution
    if (!execution) return yield* Effect.die(new Error("execution context missing"))
    const frame = yield* state.retainTask(child.id)
    yield* Deferred.succeed(setup, { frame, parent: execution, epoch: yield* CurrentTelegramEpoch })
    return result
  }), "original-parent")
  const captured = yield* Deferred.await(setup)
  expect((yield* state.execution(parent.id))?.runId).toBe("original-parent")
  yield* state.ensureRunning(child.id, Effect.succeed(result), Effect.succeed(result).pipe(
    Effect.provideService(CurrentTelegramExecution, captured.frame.execution),
  )).pipe(
    Effect.provideService(CurrentTelegramExecution, captured.frame.execution),
    Effect.provideService(CurrentTelegramContinuation, { frame: captured.frame, owner: captured.frame.execution.owner }),
  )
  expect((yield* state.execution(parent.id))?.runId).toBe("original-parent")
  yield* state.ensureRunning(parent.id, Effect.succeed(result), Effect.gen(function* () {
    expect(yield* CurrentTelegramContinuation).toBeUndefined()
    const stale = yield* checkpoint.pipe(Effect.provideService(CurrentTelegramEpoch, captured.epoch), Effect.exit)
    expect(stale._tag).toBe("Failure")
    expect(yield* CurrentTelegramEpoch).not.toBe(captured.epoch)
    const update = yield* state.retainTask(child.id)
    yield* state.ensureRunning(child.id, Effect.succeed(result), Effect.succeed(result)).pipe(
      Effect.provideService(CurrentTelegramExecution, update.execution),
      Effect.provideService(CurrentTelegramEpoch, undefined),
      Effect.provideService(CurrentTelegramContinuation, { frame: update, owner: update.execution.owner }),
    )
    yield* state.releaseTask(update)
    return result
  }), "original-parent").pipe(
    Effect.provideService(CurrentTelegramExecution, captured.parent),
    Effect.provideService(CurrentTelegramContinuation, { frame: captured.frame, owner: captured.parent.owner }),
  )
  yield* state.releaseTask(captured.frame)
  expect(yield* state.execution(parent.id)).toBeNull()
  let recreated = false
  const stale = yield* state.ensureRunning(parent.id, Effect.succeed(result), Effect.sync(() => { recreated = true; return result })).pipe(
    Effect.provideService(CurrentTelegramExecution, captured.parent), Effect.exit,
  )
  expect(stale._tag).toBe("Failure")
  expect(recreated).toBe(false)
}))
