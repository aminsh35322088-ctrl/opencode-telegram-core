import { afterEach, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { Session } from "../../src/session/session"
import { SessionRunState } from "../../src/session/run-state"
import { checkpoint } from "@opencode-ai/core/telegram-execution-context"
import { disposeAllInstances, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffectShared } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"

const it = testEffectShared(Layer.mergeAll(LayerNode.compile(LayerNode.group([Session.node, SessionRunState.node])), httpApiLayer))
afterEach(disposeAllInstances)

it.instance("runtime API pauses and resumes the existing fiber, fences old controls, and deletes a paused run", () => Effect.gen(function* () {
  const test = yield* TestInstance
  const sessions = yield* Session.Service
  const state = yield* SessionRunState.Service
  const session = yield* sessions.create()
  const ready = yield* Deferred.make<void>()
  const release = yield* Deferred.make<void>()
  let continued = 0
  let finalized = false
  const fiber = yield* state.ensureRunning(session.id, Effect.die(new Error("cancelled")), Effect.gen(function* () {
    yield* Deferred.succeed(ready, undefined)
    yield* Deferred.await(release)
    yield* checkpoint
    continued += 1
    return yield* Effect.never
  }), "api-run").pipe(Effect.ensuring(Effect.sync(() => { finalized = true })), Effect.forkChild)
  yield* Deferred.await(ready)
  const control = (action: string, runId = "api-run") => requestInDirectory(`/session/${session.id}/${action}`, test.directory, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }),
  })
  const pause = yield* control("pause")
  expect(pause.status).toBe(200)
  expect(yield* pause.json).toEqual({ runId: "api-run", paused: true, continuation: "live" })
  const otherDirectory = yield* tmpdirScoped()
  const foreign = yield* requestInDirectory(`/session/${session.id}/resume`, otherDirectory, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: "api-run" }),
  })
  expect(foreign.status).toBe(400)
  yield* Deferred.succeed(release, undefined)
  yield* Effect.sleep("10 millis")
  expect(continued).toBe(0)
  expect(finalized).toBe(false)
  const stale = yield* control("resume", "old-run")
  expect(stale.status).toBe(409)
  const staleAbort = yield* control("abort", "old-run")
  expect(staleAbort.status).toBe(409)
  expect(finalized).toBe(false)
  const changed = yield* requestInDirectory(`/session/${session.id}`, test.directory, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metadata: { label: "app" } }),
  })
  expect(changed.status).toBe(200)
  expect(((yield* changed.json) as Session.Info).metadata?.telegramExecution).toEqual({ runId: "api-run", paused: true })
  const resume = yield* control("resume")
  expect(resume.status).toBe(200)
  yield* Effect.sleep("10 millis")
  expect(continued).toBe(1)
  yield* control("pause")
  const removed = yield* requestInDirectory(`/session/${session.id}`, test.directory, { method: "DELETE" })
  expect(removed.status).toBe(200)
  yield* Fiber.await(fiber)
  expect(finalized).toBe(true)
}))

it.instance("recovered pause reports a lost continuation and requires destructive abort before reuse", () => Effect.gen(function* () {
  const test = yield* TestInstance
  const sessions = yield* Session.Service
  const session = yield* sessions.create()
  yield* sessions.setMetadata({ sessionID: session.id, metadata: { telegramExecution: { runId: "lost-run", paused: true } } })
  const execution = yield* requestInDirectory(`/session/${session.id}/execution`, test.directory)
  expect(execution.status).toBe(200)
  expect(yield* execution.json).toEqual({ runId: "lost-run", paused: true, continuation: "unavailable" })
  const forked = yield* requestInDirectory(`/session/${session.id}/fork`, test.directory, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  })
  expect(forked.status).toBe(200)
  expect(((yield* forked.json) as Session.Info).metadata?.telegramExecution).toBeUndefined()
  const control = (action: string) => requestInDirectory(`/session/${session.id}/${action}`, test.directory, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: "lost-run" }),
  })
  expect((yield* control("resume")).status).toBe(409)
  expect((yield* control("abort")).status).toBe(200)
  const after = yield* requestInDirectory(`/session/${session.id}/execution`, test.directory)
  expect(yield* after.json).toBeNull()
}))
