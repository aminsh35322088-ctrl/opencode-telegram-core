# Core process lifecycle audit (in progress, 2026-10-02)

Core completes independently before Bot migration. Bot PR #189 stays unmerged;
Bot source, pins and production are frozen until Core stable. This audit records
remaining Core gates, not a stable release claim.

| Boundary | Current owner | Evidence / remaining work |
| --- | --- | --- |
| Manual/model shell via CrossSpawnSpawner | Captured runtime execution and phase, when governed as shell | New physical Linux regressions cover parent pause/resume, abort while stopped, normal leader exit with descendants and retired identity. Merged PR #20: upstream 168 pass/2 expected skip, native 298 pass, Python 24 pass, 100 further Linux owned-shell stress passes; candidate and main CI/native Railway smoke green. |
| Custom-tool execFile | Captured invocation/run/session/canonical workspace | Existing group accounting, cancellation, pause/time limits, output bounds and invocation cleanup tests must stay green. No daemon-launcher lifetime assumption. |
| MCP stdio transport | Workspace instance's cached client and finalizer | **Candidate:** SDK framing/client protocol retained; Core stdio adapter uses existing Process service/group ownership and joins cleanup. SDK-owned spawn, close-finally release and best-effort pgrep cleanup removed. Focused physical descendant/compatibility checks passed; full/review pending. Workspace startup/teardown race remains open. |
| LSP | Workspace instance's client and shutdown | **Open gate:** Process.spawn binds only leader; exit releases admission, and Process.stop sends leader TERM without joining confirmed group death. Must retain lifetime through group cleanup. |
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

Further gate found during this boundary audit: standalone Telegram headless serve
currently does not activate the process-budget environment flag itself. Bot historically
supplied it. Core stable must activate/verify governors independently at the headless
entrypoint; this candidate does not claim that activation or actual runtime soak.

Initial MCP candidate full gate passed308 tests/2 expected skips, original five
cancellation repeats and CI37007067132, but review found a cleanup-failure notification
gap. Deterministic regressions reproduced false onclose, disconnect swallowing failure
and dropped workspace owner, and connected/tool state after fatal transport failure.
Candidate now preserves failed identity/admission, withdraws tools, propagates cleanup
failure, joins all workspace service closes and retires a service before replacement
admission.25 focused MCP lifecycle/transport tests pass after these fixes; full/review
verification is running. Initial green CI alone did not close the gate.
