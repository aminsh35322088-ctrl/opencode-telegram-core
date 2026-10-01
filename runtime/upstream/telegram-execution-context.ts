import { Cause, Context, Effect } from "effect"
import { DeadlineExceededError, withDeadline } from "./telegram-deadline"
import type { ExecutionOwner, SessionExecutionFrame, SessionExecutionLease } from "./session-execution-control"

// Captured by the live runner and inherited by its Effect bridges. It must
// never resolve an owner dynamically from the current session or Topic.
export const CurrentTelegramExecution = Context.Reference<SessionExecutionLease | undefined>(
  "@opencode/TelegramExecution",
  { defaultValue: () => undefined },
)

export const CurrentTelegramContinuation = Context.Reference<{
  readonly frame: SessionExecutionFrame
  readonly owner: ExecutionOwner
} | undefined>("@opencode/TelegramContinuation", { defaultValue: () => undefined })

export const CurrentTelegramEpoch = Context.Reference<number | undefined>("@opencode/TelegramEpoch", {
  defaultValue: () => undefined,
})

export const checkpoint = Effect.gen(function* () {
  const execution = yield* CurrentTelegramExecution
  const epoch = yield* CurrentTelegramEpoch
  if (execution) yield* Effect.promise((signal) => execution.checkpoint(signal, epoch))
})

export function activeDeadline<A, E, R, E2, R2>(
  work: Effect.Effect<A, E, R>,
  timeoutMs: number,
  onTimeout: Effect.Effect<A, E2, R2>,
): Effect.Effect<A, E | E2, R | R2> {
  return Effect.gen(function* () {
    const activity = yield* CurrentTelegramExecution
    const clock = Effect.promise((parentSignal) =>
      withDeadline(async () => await new Promise<never>(() => {}), {
        timeoutMs,
        label: "execution",
        parentSignal,
        ...(activity ? { activity } : {}),
      }),
    )
    return yield* Effect.raceFirst(work, clock).pipe(
      Effect.catchCause((cause): Effect.Effect<A, E | E2, R | R2> =>
        Cause.squash(cause) instanceof DeadlineExceededError ? onTimeout : Effect.failCause(cause),
      ),
    )
  })
}
