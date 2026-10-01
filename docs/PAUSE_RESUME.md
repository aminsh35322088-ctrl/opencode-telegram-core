# Live execution pause/resume (unreleased)

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
- Delete cancels before removing stored sessions. Disposal retires authority
  and attempts all owned resource and runner cleanup despite individual errors.

## Remaining release gates

This runtime source is not the complete client-facing migration. Native worker
control, delivery gates, client deadline/liveness behavior, producer run tags,
custom-tool process ownership, and the Bot's Telegram controls still require
integration and verification. Runtime, generated SDK, and native artifacts must
ship from one verified prerelease before the Bot removes its old pause behavior.
Full Linux CI, artifact identity checks, ownership audit, Railway validation and
production RC soak remain required. No stable release is implied by these tests.
