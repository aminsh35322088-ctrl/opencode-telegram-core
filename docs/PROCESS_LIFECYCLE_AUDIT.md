# Core process lifecycle audit (in progress, 2026-10-02)

Core completes independently before Bot migration. Bot PR #189 stays unmerged;
Bot source, pins and production are frozen until Core stable. This audit records
remaining Core gates, not a stable release claim.

| Boundary | Current owner | Evidence / remaining work |
| --- | --- | --- |
| Manual/model shell via CrossSpawnSpawner | Captured runtime execution and phase, when governed as shell | New physical Linux regressions cover parent pause/resume, abort while stopped, normal leader exit with descendants and retired identity. Merged PR #20: upstream 168 pass/2 expected skip, native 298 pass, Python 24 pass, 100 further Linux owned-shell stress passes; candidate and main CI/native Railway smoke green. |
| Custom-tool execFile | Captured invocation/run/session/canonical workspace | Existing group accounting, cancellation, pause/time limits, output bounds and invocation cleanup tests must stay green. No daemon-launcher lifetime assumption. |
| MCP stdio transport | Workspace instance's cached client/transport and finalizer | PR #22 merged: SDK framing/client protocol retained; Core service/group cleanup joins confirmed retirement, including failed acquisitions registered before handshake. 312 upstream pass/2 expected skip, 220 Linux stress passes, CI and exact candidate native Railway smoke green. Workspace startup/teardown race remains open. |
| LSP | Workspace instance's client, pending acquisition and shutdown | PR #21 group cleanup merged. Workspace candidate marks closing, owns initialization processes, joins pending acquisitions and retires late handles/clients before publication. Three causal real-process regressions cover initialization, late publication and bounded stalled acquisition; full/stress verification pending. |
| PTY | Core workspace PTY service/session | **Open gate:** high-level core Pty service already acquires PTY admission, but releases on leader exit; teardown sends kill without joining group cleanup. Low-level adapters are behind that existing governed boundary. Retain service lifetime through confirmed cleanup. |

## Shell invariants under verification

- Capture ownership before asynchronous admission; do not look up a replacement
  run/session at signal time. Gate only execution-owned shells; Core utility
  snapshot/truncation cleanup retains its existing bounded destructive authority.
- SIGSTOP/SIGCONT operate on the same isolated POSIX group. Parent pause does not
  abort/recreate children. Retirement kills stopped groups without requiring resume.
- Leader exit and pipe close alone cannot release a shell group's lease. Scope and
  explicit handle kill both join bounded cleanup; uncertain cleanup fences execution
  and retains accounting.
- Retired identity cannot receive later pause/resume/abort or handle.kill signals.
- Failed paused attachment returns cleanup to its caller and keeps execution fenced;
  it cannot leave a second unremovable resource/signal authority registered.

## Validation and resource observations

The physical stopped-state regression failed before hooks and passed after them.
Focused actual ShellTool/manual runner coverage passed before review. Review found
retained-handle signal bypass and failed attachment registration; deterministic
red regressions reproduced both and both fixes passed focused/full verification and repeated Linux stress before PR #20 merged.
An initially overbroad checkpoint blocked cancellation Snapshot.patch cleanup;
its focused regression was diagnosed and passes after restricting the gate to shells.

A focused fixture admission failed under concurrent typecheck when the Cloud cgroup
sample rounded to 8192 MiB against an 8192 MiB limit. This is a pressure rejection,
not a cleanup race. Sequential verification is required in this workspace. A later
idle sample was memory.current=2,793,959,424 bytes, memory.max=8,589,934,592,
inactive_file=463,896,576, process RSS under 36 MiB for the largest resident process.
These are Cloud diagnostic samples, not Railway production baselines or an
optimization claim. Core's existing Railway smoke image tests native code but runs
only a conformance health server; an actual runtime candidate soak/resource pass
is still required before RC/stable.

## LSP process boundary candidate

Two physical Linux tests reproduced current main defects: `Process.stop` returns
with a TERM-resistant server alive, and normal leader exit leaves a descendant
with redirected output alive. Candidate POSIX workspace-service group ownership
retains admission until terminal closure and confirmed group death, and caches
cleanup so retired identities cannot be signaled again. Launch failures return
admission; uncertain cleanup retains it. This owner is not an arbitrary model run.

This focused process-boundary fix does not close LSP workspace startup/teardown
races, MCP SDK spawning/cleanup, PTY group cleanup or detached browser lifecycle.
Full verification and review for the candidate are in progress. No RC/stable claim.

Expanded compatibility verification exposed an unrelated timing assertion in the
paused shell-readiness regression: it raced readiness against 100 ms of scheduler
and SQLite latency. The test now asserts readiness is already open when cancellation
returns. Removing the production readiness finalizer makes this causal assertion
fail deterministically; restoring it passed 20 focused repetitions. No production
cancellation ordering, cleanup deadline or timeout was changed. The expanded full
gate is being verified before merge. Initial candidate Railway smoke was cancelled
by restoring main before its health probe; it is not accepted as passing evidence.

## MCP transport candidate

Physical MCP disconnect initially returned with a descendant alive; Core-owned
stdio service cleanup now passes that regression. SDK framing is reused; no SDK
private fields or raw spawn fallback. Focused MCP, LSP and Process suite:96 pass.
The old startup-timeout test relied on a PID file being written during SDK's slow
shutdown; it now observes the actual Process.spawn PID and asserts death immediately
when failure returns. A separate disabled-admission regression reproduced unjoined
service cleanup; POSIX service group lifetime now remains independent of optional
admission accounting. Windows MCP service launch fails closed.

Standalone Telegram headless serve previously did not activate the process-budget
flag itself; Bot historically supplied it. A new entrypoint regression reproduced
admission of three utility processes with both unset and inherited disabled flags.
Candidate now enables admission before dynamic server import, enforces the two-process
utility limit with real subprocesses and verifies returned accounting after exit.
PR23 merged as `640becc950605790b1fff368557885833886704a`; candidate d0bbbe20 had
upstream314 pass/2 expected skips, five original cancellation repeats, toolchain24
pass, headless20 repetitions, clean review and CI37012834718 green. Compiled binary
124,344,448 bytes identifies exact d0bbbe20 source. Direct API probe with inherited0
passed two real shells, third rejection before command execution, physical parent/child
pause, same PID resume, abort while paused with confirmed death and reuse of capacity.
The existing API returns a generic HTTP500 on budget rejection; probe response assumptions
were corrected without changing production behavior. Candidate native Railway smoke
`4db9fb42-9e7b-4e0b-8b33-dd7315d44995` SUCCESS/native298 pass/0 fail/health succeeded.
Actual runtime resource and Railway soak verification remains required.

Initial MCP candidate full gate passed308 tests/2 expected skips, original five
cancellation repeats and CI37007067132, but review found a cleanup-failure notification
gap. Deterministic regressions reproduced false onclose, disconnect swallowing failure
and dropped workspace owner, and connected/tool state after fatal transport failure.
Candidate now preserves failed identity/admission, withdraws tools, propagates cleanup
failure, joins all workspace service closes and retires a service before replacement
admission.25 focused MCP lifecycle/transport tests pass after these fixes; full/review
verification is running. Initial green CI alone did not close the gate.

Further review found failed acquisition could lose its transport before SDK client
registration. Regression reproduced a second actual spawn while original cleanup
was uncertain (admission deliberately disabled), and now passes with one retained
workspace transport. Owner registration precedes handshake; its exact identity is
removed only on confirmed cleanup, replacements must join it, and workspace finalizer
is registered before initial acquisitions and covers unregistered transports too.
26 MCP lifecycle/transport focused tests pass; full gate/review are running. CI37008090498
failed only at a synthetic test ChildProcess cast; corrected explicit unknown cast
preserves the intentional partial fixture and does not change runtime cleanup.

Final MCP candidate `3f807822c3e421a6c4ec888452169bbcc1cf5a25`: full upstream312 pass,
2 expected skips, zero failures, typecheck/SDK build/surface and all five original
cancellation repeats passed. Additional Linux MCP/service stress220 pass. Focused
review found no further actionable issues. CI37009589230 green; Railway native smoke
`730f77d8-6c0b-459b-af0a-7384f890fbd1` exact candidate SUCCESS, native298 pass/0 fail,
health succeeded. PR22 merged as `adb98f639c52fcb8c9c45a5c0f6f9f435f355bcb`.
These results do not close workspace startup/teardown or actual runtime soak gates.

## LSP workspace acquisition candidate

Disposal previously returned with a server still initializing; a second causal
regression published a delayed client after teardown began. Candidate owns the
process before initialize, marks closing before shutdown, snapshots pending tasks
before awaiting cleanup and joins them. Late handles and initialized clients join
retirement rather than entering the client list. Confirmed process retirement drops
the process reference; failed cleanup preserves it. Task completion handlers observe
both outcomes without creating an unhandled rejected finally promise.
Focused LSP59 pass and both red/green regressions passed; repeated Linux and full
verification/review are in progress. MCP workspace races and PTY lifecycle remain gates.

Review found the first candidate's pending-acquisition join could wait forever.
A stalled-spawn regression reproduced that hang and a process hidden before handle
return. Startup now captures workspace cancellation and registers every Process
launch immediately, including installer groups. It holds existing helper admission
until underlying startup settles. Disposal aborts startup/downloads, joins group
cleanup and bounds acquisition settlement at the existing five-second cleanup limit;
uncertain startup retains admission and blocks replacement. Late launches through
the captured cancelled owner are rejected.

Real npm registry cancellation still remained pending after its signal reached the
fetch layer. Narrow diagnostics confirmed signal delivery; `make-fetch-happen` then
treated abort as retry and kept backoff. Patch0007 uses upstream's existing Bun patch
mechanism to stop the public retry operation on abort. Actual stalled-registry and
already-scheduled backoff regressions fail before the patch and pass after it.
Ordinary HTTP503-to-success retry behavior stays green. Direct download cancellation
also closes the actual socket. A first HTTP-polyfill close-event fixture assertion
was replaced with a raw TCP fixture to observe the connection itself.
Expanded verification now includes existing Core npm/config compatibility tests.
Full gate and renewed review are pending; this candidate is not merged or release ready.

The fresh full gate passed Core npm/config10 and upstream320 tests/2 expected skips,
but one npm fixture asserted server-side socket closure before its close event.
Cancellation had already rejected promptly. The fixture now joins actual TCP close
within the same five-second bound; no production timing changed. Focused seven
LSP/download/npm tests pass, including direct observation that abort clears the real
60-second backoff timer. Ordinary retry still passes. Renewed review found no further
actionable defects; full gate and Linux repetition remain pending.
