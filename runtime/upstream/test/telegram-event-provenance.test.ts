import { expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import {
  captureEventOrigin,
  CurrentTelegramEpoch,
  CurrentTelegramEventOrigin,
  CurrentTelegramExecution,
} from "@opencode-ai/core/telegram-execution-context"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID } from "../../src/session/schema"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Session.node, SessionRunState.node, SessionProjector.node, EventV2Bridge.node])),
)

it.instance("ordinary completion cannot retire an owner while paused even with no tools", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create()
    const info = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: session.id,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
      time: { created: Date.now() },
    })
    const started = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    let completed = false
    let idle = 0
    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type === "session.idle") idle++
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const work = yield* state
      .ensureRunning(
        session.id,
        Effect.never,
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(finish)
          return { info, parts: [] }
        }),
        "paused-finish",
      )
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            completed = true
          }),
        ),
        Effect.forkChild,
      )
    yield* Deferred.await(started)
    yield* state.pause(session.id, "paused-finish")
    yield* Deferred.succeed(finish, undefined)
    yield* Effect.sleep("20 millis")
    const observed = { completed, idle, execution: yield* state.execution(session.id) }
    // Rescue an old implementation without masking the observed retirement.
    if (observed.execution) yield* state.resume(session.id, "paused-finish")
    yield* Fiber.join(work)
    expect(observed).toEqual({
      completed: false,
      idle: 0,
      execution: { runId: "paused-finish", paused: true, continuation: "live" },
    })
    expect(completed).toBe(true)
    expect(idle).toBe(1)
  }),
)

it.instance("runner completion events retain the completed run identity", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create()
    const info = yield* sessions.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: session.id,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") },
      time: { created: Date.now() },
    })
    const seen: Array<{ type: string; origin: unknown }> = []
    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type === "session.status" || event.type === "session.idle")
          seen.push({ type: event.type, origin: event.metadata?.telegramExecution })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    yield* state.ensureRunning(session.id, Effect.never, Effect.succeed({ info, parts: [] }), "completed-run")
    expect(seen.map((event) => event.type)).toEqual(["session.status", "session.idle"])
    for (const event of seen)
      expect(event.origin).toEqual({
        version: 1,
        root: { sessionId: session.id, runId: "completed-run", directory: session.directory },
        producer: { sessionId: session.id, runId: "completed-run", directory: session.directory },
        epoch: 1,
      })
  }),
)

it.instance("cancellation terminal events retain the retired owner", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const state = yield* SessionRunState.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create()
    const started = yield* Deferred.make<void>()
    const seen: unknown[] = []
    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        if (event.type === "session.idle") seen.push(event.metadata?.telegramExecution)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const work = yield* state
      .ensureRunning(
        session.id,
        Effect.die(new Error("cancelled")),
        Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        "cancelled-run",
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    yield* state.cancel(session.id)
    yield* Fiber.await(work)
    expect(seen.length).toBeGreaterThan(0)
    for (const origin of seen)
      expect(origin).toEqual({
        version: 1,
        root: { sessionId: session.id, runId: "cancelled-run", directory: session.directory },
        producer: { sessionId: session.id, runId: "cancelled-run", directory: session.directory },
        epoch: 1,
      })
  }),
)

it.instance("publisher captures child and original root ownership and overrides forged metadata", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create()
    const childSession = yield* sessions.create({ parentID: session.id })
    const control = new SessionExecutionControl()
    const root = control.start({ sessionId: session.id, runId: "original-root", directory: session.directory })
    const child = control.start(
      { sessionId: childSession.id, runId: "child-run", directory: session.directory },
      root.owner,
    )
    const seen: Array<Record<string, unknown> | undefined> = []
    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        seen.push(event.metadata)
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    yield* events
      .publish(
        SessionStatus.Event.Status,
        { sessionID: childSession.id, status: { type: "busy" } },
        {
          metadata: { telegramExecution: { root: { runId: "forged" } }, marker: "kept" },
        },
      )
      .pipe(
        Effect.provideService(CurrentTelegramExecution, child),
        Effect.provideService(CurrentTelegramEpoch, child.epoch),
      )
    expect(seen[0]?.telegramExecution).toEqual(captureEventOrigin(child, child.epoch))
    expect(seen[0]?.marker).toBe("kept")
    control.close(root.owner)
    control.start({ ...root.owner, runId: "replacement-root" })
    expect((seen[0]?.telegramExecution as { root: { runId: string } }).root.runId).toBe("original-root")
    yield* events.publish(
      SessionStatus.Event.Status,
      { sessionID: session.id, status: { type: "busy" } },
      {
        metadata: { telegramExecution: captureEventOrigin(child, child.epoch) },
      },
    )
    expect(seen[1]?.telegramExecution).toBeUndefined()
  }),
)

it.instance("publication waits through pause and rejects an earlier producer phase", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create()
    const control = new SessionExecutionControl()
    const run = control.start({ sessionId: session.id, runId: "root-run", directory: session.directory })
    const frame = control.retain(run.owner)
    const phase = run.epoch
    let delivered = 0
    const unsubscribe = yield* events.listen(() =>
      Effect.sync(() => {
        delivered++
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    const publish = events
      .publish(SessionStatus.Event.Status, { sessionID: session.id, status: { type: "busy" } })
      .pipe(Effect.provideService(CurrentTelegramExecution, run), Effect.provideService(CurrentTelegramEpoch, phase))
    control.pause(run.owner)
    const pending = yield* publish.pipe(Effect.forkChild)
    yield* Effect.sleep("10 millis")
    expect(delivered).toBe(0)
    control.resume(run.owner)
    yield* Fiber.join(pending)
    expect(delivered).toBe(1)
    control.finish(run.owner)
    frame.continue(run.owner)
    const stale = yield* publish.pipe(Effect.exit)
    expect(stale._tag).toBe("Failure")
    expect(delivered).toBe(1)
    control.close(run.owner)
  }),
)

it.instance("host terminal events keep a snapshot after ordinary owner retirement", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const events = yield* EventV2Bridge.Service
    const session = yield* sessions.create()
    const control = new SessionExecutionControl()
    const run = control.start({ sessionId: session.id, runId: "completed-run", directory: session.directory })
    const origin = captureEventOrigin(run, run.epoch)
    control.finish(run.owner)
    let seen: unknown
    const unsubscribe = yield* events.listen((event) =>
      Effect.sync(() => {
        seen = event.metadata?.telegramExecution
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
    yield* events
      .publish(SessionStatus.Event.Status, { sessionID: session.id, status: { type: "idle" } })
      .pipe(Effect.provideService(CurrentTelegramEventOrigin, origin))
    expect(seen).toEqual(origin)
  }),
)
