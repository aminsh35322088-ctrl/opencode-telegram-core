# Owned result polling

`pollRunResult(run, read, options)` waits for an explicit result under one immutable `RunIdentity`. The caller supplies `isCurrent(run)` from the authoritative binding/run registry. It must compare the entire identity, including directory and binding/worker generations, rather than only a session ID.

Application tasks should use `OpenCodeTaskContext.poll(read, { timeoutMs, intervalMs, maxAttempts })`. The worker supplies its exact ownership fence and signal; the application cannot substitute a different run. A completed, stopped, poisoned or replacement worker cannot accept a late result.

The reader receives an abort signal and returns:

- `{ status: "pending", retryAfterMs? }` when another bounded read is needed; a positive finite diagnostic recheck delay may shorten the default interval;
- `{ status: "complete", value }` for a final result;
- `{ status: "failed", error }` for a terminal failure.

Pending reads consume attempts. Reads, delays and total duration are bounded by the overall deadline. Cancellation interrupts both pending reads and sleep even when a transport ignores the signal. Identity is checked before and after every read. There are no implicit retries of thrown errors or failed outcomes.

The reader must be observational: starting model/tool execution or emitting output is outside this API. Ownership of sessions/processes remains with the surrounding worker/temporary-session lifecycle. A transport that ignores cancellation may finish its request later, but that result cannot be returned as current output.

Errors are distinguished by `StalePollRunError`, `PollAttemptsExceededError`, `DeadlineExceededError`, the parent's abort reason, or the reader's own terminal error. A timeout or attempt limit is not successful completion. Application-specific parsing, diagnostics, prompts and interaction policy remain in the Bot.

All loop state is local to one invocation. Positive finite deadlines/intervals and a positive integer attempt limit are required. No global polling state or unbounded loop is used.
