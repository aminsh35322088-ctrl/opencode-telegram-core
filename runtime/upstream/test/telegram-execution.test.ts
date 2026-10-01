import { expect, test } from "bun:test"
import { Effect, Fiber, Scope } from "effect"
import { Runner } from "../../src/effect/runner"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import { activeDeadline, checkpoint, CurrentTelegramExecution } from "@opencode-ai/core/telegram-execution-context"

test("the live runner retains its fiber and result across a pause", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const control = new SessionExecutionControl()
    const run = control.start({ sessionId: "parent", runId: "run-1", directory: "/topic-a" })
    const runner = Runner.make<string>(yield* Scope.Scope)
    control.pause(run.owner)
    let calls = 0
    const fiber = yield* runner.ensureRunning(Effect.gen(function* () {
      yield* checkpoint
      calls += 1
      return "same continuation"
    }).pipe(Effect.provideService(CurrentTelegramExecution, run))).pipe(Effect.forkChild)
    yield* Effect.sleep("10 millis")
    expect(runner.state._tag).toBe("Running")
    expect(calls).toBe(0)
    expect(run.signal.aborted).toBe(false)
    control.resume(run.owner)
    expect(yield* Fiber.join(fiber)).toBe("same continuation")
    expect(calls).toBe(1)
    control.finish(run.owner)
  })))
})

test("runner cancellation interrupts a paused checkpoint", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const control = new SessionExecutionControl()
    const run = control.start({ sessionId: "parent", runId: "run-1", directory: "/topic-a" })
    const runner = Runner.make<string>(yield* Scope.Scope, { onInterrupt: Effect.succeed("cancelled") })
    control.pause(run.owner)
    const fiber = yield* runner.ensureRunning(checkpoint.pipe(
      Effect.as("unsafe"), Effect.provideService(CurrentTelegramExecution, run),
    )).pipe(Effect.forkChild)
    yield* Effect.sleep("10 millis")
    yield* runner.cancel
    expect(yield* Fiber.join(fiber)).toBe("cancelled")
    control.close(run.owner)
  })))
})

test("the subagent active deadline preserves paused work and resumes its existing fiber", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const control = new SessionExecutionControl()
    const parent = control.start({ sessionId: "parent", runId: "run-1", directory: "/topic-a" })
    const child = control.start({ sessionId: "child", runId: "run-1", directory: "/topic-a" }, parent.owner)
    control.pause(parent.owner)
    let timedOut = false
    const work = activeDeadline(checkpoint.pipe(Effect.as("continued")), 30, Effect.sync(() => {
      timedOut = true
      return "timed out"
    })).pipe(Effect.provideService(CurrentTelegramExecution, child))
    const fiber = yield* work.pipe(Effect.forkChild)
    yield* Effect.sleep("60 millis")
    expect(timedOut).toBe(false)
    expect(child.signal.aborted).toBe(false)
    control.resume(parent.owner)
    expect(yield* Fiber.join(fiber)).toBe("continued")
    control.close(parent.owner)
  })))
})

test("an expired deadline interrupts work before running an asynchronous timeout handler", async () => {
  let workCompleted = false
  const result = await Effect.runPromise(activeDeadline(
    Effect.sleep("50 millis").pipe(Effect.andThen(Effect.sync(() => { workCompleted = true; return "late work" }))),
    10,
    Effect.sleep("100 millis").pipe(Effect.as("timeout")),
  ))
  expect(result).toBe("timeout")
  expect(workCompleted).toBe(false)
})
