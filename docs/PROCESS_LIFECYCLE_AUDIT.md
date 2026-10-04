# Core process lifecycle audit (in progress, 2026-10-02)

> Current production scope: [Minimum Telegram release report](MINIMUM_TELEGRAM_RELEASE.md). Historical full-upstream gates below are superseded by the scoped correction at the end of this document.

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

LSP workspace candidate70676cdd passed fresh typecheck/SDK surface, Core npm10,
upstream321/2 expected skips/0 failures and five original cancellation repeats.
Ten further Linux rounds70 pass; focused review clean; CI37019611580 green.
Exact Railway native smoke7cb64a27 SUCCESS/native298/health, source restored main.
PR24 merged as1a24fa39db69a426da8d558d31edd82bf406c342; main CI37020515860 and
artifact build37020933394 green. No new release; Core remains pre.8, Bot frozen.

## MCP local workspace lifecycle candidate

Two causal actual-process regressions reproduce delayed client publication after
workspace disposal and overlapping replacements cancelling one another. Closing
now fences initial/dynamic publication and callbacks. Per-server permits serialize
lifecycle transitions; acquisition completion is tracked before interruptible work.
Disposal joins service retirement and bounded pending completion. A third regression
caught capturing the disconnect target before waiting for its permit: it returned
with the replacement still alive. Disconnect now captures current ownership inside
the permit. Focused/full/stress/review verification pending. Remote transports and
workspace OAuth pending-state ownership are separate remaining audit gates.

## Telegram production scope correction (slimming candidate)

The authoritative current Bot audit supersedes the full-upstream scope above:
see [consumer call-sites](BOT_CORE_CALLS.md), [subsystem audit](superpowers/specs/2026-10-02-minimum-telegram-core.md)
and [candidate readiness](MINIMUM_TELEGRAM_RELEASE.md).
PTY, its native adapter/ticket/upgrade routes, automatic MCP OS-browser launching,
upstream remote workspace routing, sharing, Console account remote config,
self-upgrade, mDNS and frontend/interactive services are excluded from the production
bundle and fail closed. Their lifecycle work is removed from production release
requirements. No shared-service SIGSTOP behavior was introduced.

The current Bot's pause workflow aborts and resumes via a continuation prompt.
Live execution/pause/resume HTTP endpoints remain production-supported for the
target native-control migration across the Node/Bun boundary; their previously
closed invariants run in both production and compatibility gates. See
[the architectural decision](TELEGRAM_EXECUTION_CONTROL.md).
Shell/custom-process authority, MCP stdio and LSP service retirement remain required.
Persistent Playwright sessions are a real Bot custom-tool feature, distinct from
OAuth browser opening. Current raw custom tools have not adopted Core's process
capability; no Bot migration is performed here. That boundary, required detached
browser ownership, remote MCP/OAuth ownership and actual crash containment remain
explicit stable blockers. A passing short soak cannot close them.

The Railway candidate image uses a child-reaping init. An un-reaping PID 1 leaves
zombies and correctly causes Core to retain uncertain service admission; cleanup
assertions/deadlines were not weakened to accommodate that environment.

## Shared retirement investigation after PR #25

PR #25 is merged at `e5dd2b1bbebe5287b4621ca35ed07a4b91956234`; pre.9 remains
the independently verified `28e7527` candidate. A new deterministic investigation
proved cleanup failure suppression, closing-workspace admission and stale-context
cache reacquisition in the shared upstream lifecycle. See
[the retirement evidence](WORKSPACE_RETIREMENT.md). Candidate `03f20bd` corrects
these failures, including terminate-before-join for physically paused model shells.
Cumulative CI, repeated Linux stress and actual compiled Railway tests are green.
This closes the reproduced shared retirement regressions, not every interrupted
bootstrap/helper acquisition, remote MCP/OAuth or persistent-browser boundary.
Broader resource, concurrency and crash/restart gates remain open. Pre.9 does not
contain this candidate; no RC/stable is published. Bot remains frozen.

### Remote MCP/OAuth ownership candidate after PR26

[PR27 evidence](MCP_OAUTH_OWNERSHIP.md) supersedes the reproduced pending OAuth
identity/retirement defects listed above: private handshake, exact callback state,
joined remote cleanup, interrupted-flow retirement and guarded credential mutation
are verified at `e6bbabe`, including the actual compiled Railway API. An orphan
callback cannot bootstrap a replacement service. This does not close raw custom
process/browser, provider/helper acquisition, independent crash containment or
realistic concurrent resource/soak gates. Bot and released artifacts remain frozen.


### 2026-10-04 integration and provider-auth checkpoint

PR27 merged as `884ae87d47f96ddbe670d4abcd4088dc2ae832da`; its source candidate
`e6bbabe` has actual compiled Railway verification. This supersedes earlier
statements that the reproduced remote MCP OAuth defects remain open. Pre.9 is
unchanged and does not contain PR26/27.

[Corrected production reachability](PROVIDER_AUTH_OWNERSHIP.md): provider-auth
HTTP routes and the ProviderAuth service are excluded from the actual compiled
Telegram graph. The full-upstream callback probes reproduce defects but do not
block Telegram RC. A shared credential-store concurrency defect is confirmed on
a retained path and its existing-lock fix is under verification. Model-time helper
and plugin acquisition remain audit gates. No callback lifecycle feature, RC/stable
publication or Bot change is included.

### Retained plugin retirement probe (2026-10-04)

A real Plugin.Service/InstanceStore probe loads two local plugin modules. The first
plugin's dispose hook throws; the second can retire normally. Current main logs the
failure and ignores it, so store.dispose reports success instead of quarantining
uncertain cleanup. The diagnostic is preserved in
`tests/diagnostics/telegram-plugin-retirement.probe.ts` and intentionally is not a
passing release assertion. Registration before async startup, joined late startup,
attempt-all cleanup and bounded uncertainty still require implementation and
cumulative verification. This required extension boundary remains an RC blocker.

Candidate common patch 0011 replaces ignored plugin cleanup with the existing
bounded deadline and shared workspace quarantine path. It registers before startup
and retains actual initialization promises through late hook publication; all hook
disposers start even when another fails. Three focused lifecycle assertions pass:
failed retirement fences replacement; interrupted startup retires its returned
hook; uncertain disposal reaches the existing five-second bound, attempts every
hook, and never clears quarantine after late settlement. A premature registration
experiment regressed late-hook disposal; that experiment was replaced before any
checkpoint/merge and the raw-promise ownership regression remains in the gate.
The unchanged pre-fix startup case itself passed, so this is not claimed as proof
of an additional original startup defect. The original ignored-cleanup defect is
also reproduced in the actual compiled runtime: global.dispose incorrectly succeeds.
Compiled green and cumulative verification of 0011 are pending. No browser/raw
process/helper or crash-containment gate is inferred closed by these hook tests.

Review identified that joining every initializer before cleanup can strand an
already loaded hook behind a permanently stuck later initializer. The corrected
candidate starts known hook disposal immediately, memoizes each disposer, and
starts late hook cleanup as soon as ownership is returned. The controlled blocked-
initializer regression fails on the prior candidate (loaded disposer count zero)
and passes after correction; loaded and late disposer counts remain exactly one.
Four focused lifecycle assertions now pass. The prior full cumulative 370-pass run
preceded this correction and is not final-candidate closure evidence. Final
cumulative and compiled/Railway verification remain required.

Final reviewed common-source candidate: 371 pass, two expected skips, zero failures,
ten helper assertions and all five shell admission/cancellation race repeats pass.
This gate includes all four plugin lifecycle regressions. Compiled pre-fix Plugin
retirement fails its new assertion (global.dispose succeeds after a hook throws),
so actual compiled green verification remains required after checkpoint build.

The required helper audit reproduced retained Azure CLI model-time acquisition in
the actual compiled runtime: fake `az` PID22106 was started by Core PID22089;
session abort acknowledged true while the helper remained alive. The diagnostic
kills/reaps only its owned fixture process and is preserved as
`tests/diagnostics/azure-compiled-ownership.probe.py`. This is a confirmed acquisition
lifetime defect, not merely an import finding. Optional CLI credential scope must
be decided against Telegram requirements; Azure API-key inference must remain.

### Exact plugin checkpoint and Azure scope correction

Checkpoint `25da66b2582a133f4ff092fda32d4e43d8fb191d` passes all three GitHub gates
(run 37186470981). Its actual compiled local gate also passes: six surface checks,
twelve execution checks (including failed plugin retirement fencing replacement)
and ten independent session-contract checks. The earlier pending compiled statements
above are superseded for this checkpoint. Railway lifecycle verification of this
checkpoint is still required; the prior deployed credential candidate is not proof.

The Azure CLI model-time helper is optional upstream functionality with no documented
Telegram consumer/install requirement. The candidate production resolver removes
that acquisition path and rejects imported CLI OAuth terminally; Azure API-key
inference is retained. See [scope and validation](PROVIDER_AUTH_OWNERSHIP.md#azure-production-credential-scope-correction-2026-10-04).
No required browser/daemon or crash-containment gate is closed by that exclusion.

### Hard crash: confirmed required process survivor (2026-10-04)

At source `32f2437ede3a0e4e87cce489d119e0d9308548a9`, the actual compiled runtime
was killed with SIGKILL after its model shell acknowledged pause and Linux `/proc`
confirmed state T. The same PID/start-time/group survived, still stopped, reparented
to the test subreaper. This is a required production crash-containment blocker, not
an optional dead graph. The bounded diagnostic owns and kills its fixture group;
`tests/diagnostics/compiled-crash-containment.probe.py` preserves the reproduction.
The test subreaper is test hygiene, not shipped crash containment.

A classified, unshipped Linux supervisor prototype uses PR_SET_CHILD_SUBREAPER and
pidfds outside Bun. Killing the same compiled Bun child then retires/reaps the paused
shell before supervisor completion. It is diagnostic evidence, not a production
fix. This environment lacks `/proc/self/task/PID/children`; adopted child discovery
must not assume that optional kernel interface. The corrected prototype enumerates
`/proc/*/stat` and holds un-reaped direct-child identity until pidfd acquisition.

Open design gates include supervisor death itself, durable replacement fencing,
packaging/consumer compatibility and behavior for detached/double-fork descendants,
MCP/LSP/helper classes, concurrent work and uncertain cleanup. An ancestor guard
cannot be claimed to survive its own SIGKILL. No RC gate is closed by this spike.
Linux references: PR_SET_CHILD_SUBREAPER(2const) and pidfd_send_signal(2) on man7.org.

The exact Azure/plugin candidate is now independently verified on Railway:
deployment `a3c4c50e-9c33-4329-9648-9c302552e6f4` SUCCESS, health endpoint reports
source `32f2437`, PID260, startup six surface/fourteen execution checks pass. The
first two sequential observation workloads complete without failures. This is
short candidate verification, not RC soak or resource/crash closure. Local
production cumulative totals are 362 pass, two expected skips and zero failures,
plus all five two-case shell race repeats, helper15 and independent session10.

The supervisor-death counterexample also reproduces: killing the prototype guard
kills Bun but leaves the same paused shell reparented to the test subreaper. A single
guard with destructive PDEATHSIG is insufficient. The prototype remains explicitly
unshipped while the surviving-authority/restart boundary is investigated.

The compiled shutdown diagnostic also confirms an independent false-success edge:
a plugin disposer writes its attempted marker and throws, yet headless SIGTERM exits
zero and reports no uncertainty. Source `Server.listen().stop` converts the stop
Effect to Exit and discards it; `makeStop` also ignores scope-close failure. This
hides previously propagated workspace retirement failures at the outer runtime
boundary. Root propagation and compiled failure-exit regression are required; they
do not alone establish crash containment or durable replacement fencing.

### Shutdown failure propagation candidate

Common patch 0012 removes listener `runPromiseExit` result discard and preserves
scope-close failures through the cached stop operation. The compiled fixture proves
its plugin disposer was attempted but the original runtime reported exit0. In this
Effect version, `ignore` suppresses typed failures, not defects: discarded Exit is
the decisive demonstrated suppression for the rejecting plugin fixture; the same
probe does not separately prove the typed scope-close case. Scope closing still
attempts every registered finalizer before aggregating failures.

Headless stop now catches failure explicitly, emits a fixed non-sensitive failure
report, retains `stopping` and sets eventual exitCode1 without force exit. A referenced
idle quarantine handle keeps the failed authority alive even if closure removed all
other event-loop handles; it performs no cleanup polling or retry. Controlled compiled
coverage checks the failure report, both attempted disposers and continued owner
liveness. Final exact-source cumulative/CI/Railway verification remains pending.
This truthful failure boundary is not hard-crash containment or cross-process
replacement fencing; both remain release blockers.

### Reproducible scoped build dependency candidate

At `e56feba`, GitHub validate and the full compiled headless gate pass; the
upstream-runtime job fails before tests because the unused Console/Web SolidJS
preview URL `pkg.pr.new/@solidjs/start@dfb2020` returns404. This is a build gate
failure, not a tested lifecycle regression. The continuing candidate installs only
runtime and SDK workspace closures from the existing patched frozen lock, using
hoisted resolution for ambient SDK/type/build-tool imports required by the pinned
source. No dependency version or upstream identity is changed. The compatibility
builder also uses its existing `--skip-install` flag, preventing three downstream
unfiltered/non-frozen installs from bypassing the initial contract.

A clean real-Bun fixture reproduces original installation failure on an expired
unused preview. Scoped installation passes with fresh cache, unchanged lock bytes,
no unused fetch and working transitive runtime/ambient SDK/own SDK dependencies.
The actual serialized common gate passes typecheck, SDK generation/formatting and
surface checks, helper10, cumulative371/two expected skips/zero failures, and all
five shell race repeats. Full binary/linker/CI/Railway verification remains required.

An earlier local production gate ran while a large diagnostic typecheck overlapped:
MCP roots timed out, shell/LSP fixtures timed out and unretired mocks caused later
LSP failures. The four initial categories pass under isolated idle execution and
exact-source headless CI is green. The new common gate is serialized and green;
actual production cumulative verification must still be repeated without that
resource overlap. This records failed evidence rather than treating reruns as proof.

### Scoped installation and escaped-tree evidence

The hoisted compiled build exposed five policy-test failures caused by a hardcoded
package-local `node_modules` path, not the AWS rejection policy. SDK verification
now resolves from the actual runtime importer with `Bun.resolveSync`. Seven bundled
provider-policy tests/29 assertions pass. Serialized compiled verification passes
362 cumulative tests/two expected skips, all five shell race repeats, helper15,
compiled surface6/execution15 (including uncertain shutdown), and compatibility10.
The binary built from `58ce9b2` is114,669,696 bytes; its graph remains exclusion-clean.
This is local compiled evidence, not exact-successor CI/Railway verification.

The next ownership risk is now causal, not just a documentation concern:
[the escaped-descendant probe](../tests/diagnostics/custom-process-tree/README.md)
reproduces successful custom-tool cleanup releasing admission while a captured
descendant in a separate process group survives. Pinned Playwright implementation
inspection confirms its daemon and browser use separate groups. Existing tests
called "detached processes" cover an admitted detached group, not descendants that
create another group. Group-only cleanup must not be described as full process-tree
ownership. Shared tree retirement and hard-crash containment remain RC blockers.
