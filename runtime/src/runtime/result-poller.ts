import type { RunIdentity } from "./identity.js";
import { abortableSleep, withDeadline, type DeadlineActivity } from "./deadline.js";

export type PollOutcome<T> = { readonly status: "pending"; readonly retryAfterMs?: number } | { readonly status: "complete"; readonly value: T } | { readonly status: "failed"; readonly error: Error };
export interface PollOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly maxAttempts: number;
  readonly isCurrent: (run: RunIdentity) => boolean;
  readonly activity?: DeadlineActivity;
  readonly checkpoint?: (signal: AbortSignal) => Promise<void>;
}

export class StalePollRunError extends Error {
  constructor() { super("polling run is no longer current"); this.name = "StalePollRunError"; }
}

export class PollAttemptsExceededError extends Error {
  constructor(readonly maxAttempts: number) { super(`result polling reached its ${maxAttempts} attempt limit`); this.name = "PollAttemptsExceededError"; }
}

export async function pollRunResult<T>(inputRun: RunIdentity, read: (signal: AbortSignal) => Promise<PollOutcome<T>>, options: PollOptions): Promise<T> {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) throw new Error("polling attempts must be a positive integer");
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) throw new Error("polling interval must be positive and finite");
  const run = Object.freeze({ ...inputRun });
  const check = (signal: AbortSignal): void => {
    signal.throwIfAborted();
    if (!options.isCurrent(run)) throw new StalePollRunError();
  };
  check(options.signal);
  return withDeadline(async (signal) => {
    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
      check(signal);
      do {
        await options.checkpoint?.(signal);
        check(signal);
      } while (options.checkpoint && options.activity?.paused);
      const outcome = await read(signal);
      check(signal);
      do {
        await options.checkpoint?.(signal);
        check(signal);
      } while (options.checkpoint && options.activity?.paused);
      if (outcome.status === "complete") return outcome.value;
      if (outcome.status === "failed") throw outcome.error;
      const delay = outcome.retryAfterMs ?? options.intervalMs;
      if (!Number.isFinite(delay) || delay <= 0) throw new Error("polling delay must be positive and finite");
      if (attempt + 1 < options.maxAttempts) await abortableSleep(Math.min(delay, options.intervalMs), signal);
    }
    throw new PollAttemptsExceededError(options.maxAttempts);
  }, { timeoutMs: options.timeoutMs, label: "result polling", parentSignal: options.signal,
    ...(options.activity ? { activity: options.activity } : {}),
  });
}
