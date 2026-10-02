# Live execution pause/resume (pre.8 prerelease)

The source integration uses the existing upstream `SessionRunState` runners and
model/tool fibers. It does not abort, recreate sessions, or send a synthetic
resume prompt. The published Bot pin remains Core pre.7 until the complete
runtime/SDK/native integration is verified and released together.

## Runtime control contract

The new legacy-session API exposes:

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/session/:sessionID/execution` | Live owner or recovered paused intent; otherwise `null` |
| POST | `/session/:sessionID/pause` | Required `{ runId }`; gates the existing execution tree |
| POST | `/session/:sessionID/resume` | Required `{ runId }`; opens the same live tree |
| POST | `/session/:sessionID/abort` | Optional `{ runId }` fences destructive cancellation; empty requests retain the upstream legacy contract |

Control clients must supply their captured canonical directory and run token.
A mismatched directory returns 400; stale or unavailable ownership returns 409.
Workspace middleware's automatic routing by session ID does not authorize a
request carrying a different owner directory.

Pause persists `metadata.telegramExecution` before acknowledging success.
Resume clears paused intent before opening gates. Application metadata updates
preserve that Core field under the same admission semaphore; new/forked sessions
do not inherit execution intent. A restarted runtime reports
`continuation: "unavailable"` for recovered pause and requires an explicit abort
before a new run. It never replays lost work to simulate continuation.

## Execution boundaries

- A lease captures session, canonical directory, and opaque logical run ID.
- Model streams, tool bridges, and progress callbacks capture a model phase
  epoch. Pause/resume keeps that epoch; an authorized background follow-up
  increments it so old callbacks cannot become valid again.
- Retained task frames preserve the original parent's pause/abort authority
  through child completion and result delivery. Host continuation grants are
  consumed at admission and removed from model execution context.
- An update of a held child requires its current direct parent phase. An old
  phase, different parent, released frame, or replacement owner is rejected.
- Child execution deadlines count active time. Paused time does not consume
  the child budget; cancellation and execution failure still interrupt it.
- Cancellation reserves admission before interrupting fibers. Reentrant child
  cancellation cannot deadlock on the admission semaphore.
- A shell that fails its execution gate before starting still releases its
  readiness latch, so cancellation cannot wait forever for an unstarted process.
- Destructive cancellation and disposal grant existing tool calls a bounded
  completion window for partial output and normal truncation. The grant is
  limited to the captured phase, admits no new work or resources, and closes
  after owned fiber cleanup before replacement admission. Ordinary model stream
  events and callbacks arriving after cleanup remain fenced.
- Admitted tool bridges remain tracked on that lease even though the AI SDK
  runs them outside the model fiber. Processor cleanup drains them before
  replacing partial results, and cancellation/disposal joins them before
  releasing admission. Tool draining has a ten-second bound; a timeout keeps
  the workspace fenced rather than admitting a replacement over unfinished work.
- Ordinary completion also joins admitted tools. Its deadline freezes while
  paused and resumes on retirement. The runner stays busy throughout idle
  cleanup, and trusted follow-up admission waits outside the admission semaphore
  before reopening a phase. An idle-cleanup failure resolves callers with the
  failure and quarantines owned runtime state instead of leaving them parked.
- Delete cancels before removing stored sessions. Disposal retires authority
  and attempts all owned resource and runner cleanup despite individual errors.

## Native acknowledgment adapter

`TelegramNativeCore` accepts an optional `executionControl` configuration with
an `OpenCodeExecutionControlPort` and a finite `requestTimeoutMs`. The port maps
`execution`, `pause` and `resume` to the runtime API above, carrying the captured
session, canonical directory and logical run ID. Model admission must pass that
same ID as `telegramRunId` to the legacy prompt/command/shell API.

`pauseRun`, `resumeRun` and `inspectExecution` operate on an existing worker's
owned target. They never create a worker or session. Temporary tasks use their
actual temporary target; cleanup retires that control target before destructive
requests and restores the root only after cleanup succeeds. A callback completing
while paused retains its temporary session until resume or explicit cancellation.

Requests are serialized per captured native run observation. Pending requests
hold client work, delivery and active-time budgets immediately. A successful
response must identify the same live run and report the requested state before
the hold is released. Binding, worker, run and temporary-target identities are
checked before and after transport. The returned response is the acknowledgment;
`RunActivity.paused` also includes pending or uncertain client holds and must not
be presented as proof that the remote runtime has acknowledged pause.

A timeout, failed request, unavailable continuation or malformed acknowledgment
leaves client work held and requires explicit abort/retirement. A later GET cannot
prove ordering against a timed-out write. Control transport has a wall-clock
deadline even while execution budgets are held; ordinary pause never invokes
the worker's abort port.

Owned tasks inherit the observation for queue deadlines, checkpoints and result
polling. Poll reads/results and Telegram mutations recheck pause after awaited
checkpoints, immediately before admission. Rich streams retain their draft lease;
custom native Markdown stream adapters must use `options.withMutation` for each
actual Telegram mutation, in addition to the ownership guard. The bundled grammY
adapter does this at its raw API boundary. Operations admitted before pause may
still finish; new mutations wait. Rotation, deletion and run retirement reject
held output instead of moving it into another generation.

Liveness and repeated-tool decisions remain non-destructive while held. Provider
retry ceilings exclude held time; reconciliation's `runStartedAt` must be the
original run-start wall-clock timestamp. Observer failure cancels client deadlines
and rejects checkpoints instead of leaving a broken observation silently parked.

## Remaining release gates

This source is not the complete client-facing migration. The aligned pre.8
artifacts passed compatibility/identity verification and are published from
`f110bd25419b6bedc40db36e9ae929bc4e52b9ac`; Bot adoption remains pending.
The actual ShellTool timeout now uses Core’s active-time deadline. A real-tool
regression with a controlled process handle proves that parent pause does not
kill the child on its timeout and resume uses the remaining active budget.
Governed manual/model-shell groups now attach to their original execution lease
and phase. Parent pause sends SIGSTOP to the group; resume sends SIGCONT to the
same group; retirement sends SIGKILL even while stopped. Ordinary leader exit
also cleans remaining descendants. Admission remains reserved until terminal
close and group death are confirmed; failure fences the execution and retains
accounting. Completed identity loses signal authority before a later control can
reach a reused PID/group. Unisolated/unsupported owned shell groups fail closed.
Persistent-daemon ownership, full Linux stress and release artifact verification
remain Core gates. Bot delivery/control/tool adoption is deferred until Core stable.
Runtime, generated SDK, and native artifacts must
ship from one verified prerelease before the Bot removes its old pause behavior.
Full Linux CI, artifact identity checks, ownership audit, Railway validation and
production RC soak remain required. No stable release is implied by these tests.
