# Core-first migration and release gates

Status: migration in progress; neither architecture nor release candidate is yet considered stable.

## Ownership and implementation plan

All runtime implementations below belong in this repository. Bot changes are limited to consuming the verified Core release and replacing migrated calls.

1. **Reusable polling:** add `runtime/src/runtime/result-poller.ts`, export it, and expose it through `OpenCodeTaskContext.poll`. An immutable run identity is checked before and after every asynchronous read. Reads use an abort signal; sleep, attempts and overall duration are bounded. Pending, completed and failed outcomes are explicit. Write cancellation, deadline, stale-result, attempt-bound and concurrent-Topic tests before implementation. Replace scheduled-task looping only after the Core artifact passes verification.
2. **Pause/resume:** add cooperative gates to the upstream session execution graph and parent/child scheduler, then expose the verified capability through the Core SDK/native worker. Pause preserves the current logical run, fibers and sessions. Gates block new model/tool steps and delivery; supported owned processes are suspended and resumed. Abort interrupts and terminates. Persist enough paused intent to recover fail-closed after restart without silently replaying tools. Replace Bot abort-and-reprompt behavior only after runtime tests pass.
3. **Custom-tool processes:** expose the existing upstream process governor to custom tools through their runtime context. Every child lease carries its session/run/workspace owner, signal and lifecycle; a tool cannot provide an alternate owner. Bind process groups to the lease, propagate parent pause/resume and abort, and release on exit. Ownership loss terminates descendants. Keep existing Railway category/global/memory limits authoritative; do not create a Bot substitute.

Use focused changes and red/green regression tests per task. Keep SDK, native library and Linux runtime aligned in each immutable prerelease. Document API changes and migration notes in README/CHANGELOG; final public release notes remain deferred.

The pre.8 prerelease [custom-tool process contract](CUSTOM_TOOL_PROCESSES.md) now reaches
the existing plugin registry using captured runtime context and the authoritative
governor. Portable and Linux process-group regressions cover ownership, pause,
cancellation and admission races. Persistent-daemon ownership remains a blocker
before complete Bot tool migration and release.

### Pause integration boundaries

The Bot currently uses the upstream legacy `SessionPrompt`/`SessionRunState` execution path. Live gates now integrate there in the pre.8 prerelease, with the runtime control API, model phase fencing, and retained background task ownership covered by Core tests. See [the pause contract and remaining gates](PAUSE_RESUME.md). The shared execution authority runs in the upstream runtime; native clients consume its API. The published Bot pin remains pre.7 while native/process/delivery integration is incomplete.

The native source now serializes control requests against existing exact worker
targets and mirrors only valid runtime acknowledgments. Pending/uncertain requests
hold client work; queue/poll deadlines, temporary completion and Telegram delivery
respect that observation. Review regressions cover cleanup during pause and fences
racing a rich mutation. Full Linux CI and aligned artifact checks precede Bot use.

- Capture the runtime execution lease once per model stream/tool invocation. Checkpoints before model/tool admission and stream/output processing retain the same live continuation across pause/resume; late callbacks cannot look up a replacement lease.
- Scope control to the canonical workspace plus session and an opaque run token. The native adapter additionally verifies the complete Topic/binding/run/generation identity before runtime control requests. Pause/resume payloads must include the captured runtime token and reject replacement or recovered owners.
- Persist paused intent before acknowledging pause. Resume must clear durable intent before opening gates. After process loss, report that a live continuation is unavailable; never implicitly recreate a model/tool run or replay side effects to simulate resume.
- Ordinary parent completion must retain control of background children. Hold the logical run's busy/ownership boundary until the last child completes. Destructive abort/rotate/delete/disposal retires the owned tree; closing a Telegram view does not enter this path.
- Keep custom processes on the existing process governor and attach lifecycle hooks to the same captured execution lease. Resource transition failure fences the whole tree, attempts to re-suspend already resumed resources, and requires explicit cleanup. Failed termination quarantines the workspace, including existing and future owners.
- Core now captures original root and independent producer ownership before live publication, with the producer phase and workspace. SSE/global events and generated SDK schemas preserve `metadata.telegramExecution`; durable replay stays untagged. Native `SessionEventRouter.resolveExecution` requires this provenance and returns the complete captured run fence after ancestry validation. Delayed old-root events and replacement during lookup fail closed. Callers must retain and recheck that fence at delivery; the legacy `resolve` method is for session/control routing, not untagged execution delivery. Bot adoption remains gated on a verified aligned prerelease and final routing audit.
- Host completion/cancellation events capture each retired owner's identity without retaining runtime authority. Ordinary completion waits through pause and rechecks pause under the admission guard before retirement; destructive cancellation still finalizes the original tree.

## Renderer integration checkpoint (2026-10-02)

PR #15 renderer work is refreshed onto Core `da4f28ab9c86b1bc9949f0635426caf85a6dac22`
on the integration branch. The older branch's shell cancellation patch is omitted;
`patches/series` and current runtime patches remain unchanged. Final output uses
GFM/Telegram parsing, semantic blocks, recursive Persian/mixed-script direction
handling and grapheme-safe chunking. Each chunk uses the current main delivery
checkpoint and exact binding/run fence. Caller budgets must be positive integers
within Telegram's hard limits; non-finite and oversized budgets fail closed.
Independent review found and reproduced additional hard-limit failures in quote
credits, combined block/inline nesting, synthesized quote blocks, cumulative table
spans/rowspans, table captions and minimal container budgets. Regression tests now
cover these; oversized spanning tables degrade to text rather than emitting spans
across message boundaries. Local native typecheck and 298 tests pass; 24 release/
toolchain contract tests passed. These results do not certify the full renderer
or release gate.

GitHub run 36909074671 passed native validation and the full upstream suite
(158 pass, 2 skip), then reproduced `cancel interrupts loop queued behind shell`
in the second focused repeat: release stalled and the expected abort marker was
missing. PR #16 subsequently fixed the deterministically reproduced output-reader
acquisition race. Its latest-main validation passed 160 upstream tests (2 skips),
all five focused repeats, 238 native tests and 24 toolchain contracts. GitHub
run 36975712031 passed both required jobs; Railway deployment
`93c6d6cb-707f-49ee-bc28-a53bad4ca57b` on `da4f28ab` passed 238 tests and health.
An additional 20 repeats of both focused cases had no process-release stalls;
two setup/readJson delays were observed under concurrent build load. The refreshed
renderer passed GitHub run 36976562712 and exact-candidate Railway smoke
`3d2eae5e-61e1-4b8b-967b-d47654f4f438` with health success, then merged at
`983bbcfb8bb3b088faa08e92e664001d48e6cc5b`. Main CI 36977388377 and main smoke
`39a759b3-2110-4204-b035-0752112a9970` passed. The pre.8 compatibility unit is verified and published from
`f110bd25419b6bedc40db36e9ae929bc4e52b9ac` by release workflow `36979098365`.
Independent download checksum and runtime/SDK/native identity checks passed;
Bot pin/adoption work can now proceed. The first local
upstream run also failed two custom-process tests because
this cloud container PID 1 retained dead descendants as zombies. A test-only Linux
subreaper restored all 14 applicable custom-process tests; production cleanup code
was not weakened. Full local verification under that reaper is separate evidence.
Bot adoption, aligned artifacts and production verification remain pending.

Recovery confirmed Bot main `471f644aefe44950f07c2e11effced4ffca7d525`, version
0.26.2 and the pre.7 compatibility pin. Bot PRs #176 and #110 remain open and
must be reconciled against current Core before adopting their runtime behavior.
Core main and Bot main CI were green at inspection. Railway Core smoke for
`ef655249` passed 238 native tests and its healthcheck, then slept normally.
Production Bot remains on `a0a0f4d0910659b9732da8650b2b3cab156f5eb6`; it was not
redeployed during recovery.

Railway production baseline at recovery (24-hour summary): reported memory
current 0.5028 GB, average 0.5956 GB, maximum 0.9999 GB; CPU current 0.0216,
average 0.0181, maximum 0.8229. Recent watchdog samples reported Bot RSS 124 MiB,
service working set about 475 MiB, raw service memory about 480 MiB, cgroup limit
954 MiB and six service processes (one admitted OpenCode server). These distinct
measurements are observations of the older deployment, not before/after
optimization evidence or a leak-free certification. Investigate the peak and
collect scenario-based trends before RC. Smoke metrics describe the smoke server,
not a full running model/tool workload.

## Review focus

- A read or process spawn finishes after its owner is rotated or deleted: reject output and clean the exact old child.
- A dependency ignores cancellation: enforce a bounded deadline without releasing a potentially live ownership boundary as healthy.
- Pause races with a child start, abort or permission request: preserve children on pause and make abort authoritative.
- Runtime restarts while paused: recover paused intent without duplicating side effects or accepting the previous generation.
- Two Topics share a host: never share execution, process, polling, SSH permission or workspace state.

## Audit and stability matrix

Current stability gate: Linux validation reproduced intermittent stalls inside
`SessionPrompt.cancel` for queued and exclusive shells. The terminal-notification
cause is now reproduced deterministically: the Effect Node stream adapter attaches
output listeners before registering their scope finalizer; interruption in that
gap leaves a `readable` listener that prevents Bun's exit-time resume from draining
the pipe. The process exits but never emits `close`, so bounded cleanup fails.
Core now makes output-reader acquisition (stdout, stderr and extra output FDs)
uninterruptible through finalizer registration. Output reads remain interruptible;
signal escalation, close deadlines and uncertain governor admission are unchanged.
A deterministic regression interrupts exactly after listener attachment and checks
listener removal and pipe destruction. A Linux regression cancels 50 actual shells
during merged-output admission and requires terminal close without cleanup defects.
Existing fixtures still cover missing close, failed TERM delivery, explicit kill
and trailing output. The deterministic regression, Linux stress, full verification,
GitHub CI and actual-main Railway smoke cited above resolve this specific fault.
The refreshed renderer has passed its own CI and exact-candidate Railway smoke.
Aligned pre.8 artifact verification/publication is complete. Bot adoption and
the remaining release gates stay open. A passing rerun alone is insufficient.

After all three tasks, audit both repositories for duplicated Core responsibilities, unjustified shims, bypass routes, ambiguous identity, General/ALL execution, stale/late delivery, lifecycle ownership and artifact identity.

The stability pass must exercise concurrent Topics/sub-agents; pause/resume and parent abort; rotate/delete and crash/recovery; request/transport failure; scheduled tasks; file/tool/SSH isolation; custom processes; polling cancellation/timeout; memory pressure; SQLite recovery and restarts. Run both complete CI suites, all builds, artifact/install verification and Railway Core smoke. A Windows directory-fsync limitation is not a Linux production workaround.

## Release sequence (Core-first stable, 2026-10-02)

Bot migration is frozen. PR #189 stays unmerged and production remains on pre.7.
Intermediate Bot prerelease pin bumps are not part of Core validation unless
needed to diagnose a specific compatibility defect.

1. Finish Core shell/process pause ownership, abort-after-pause, cleanup and
   explicit persistent-daemon ownership. Preserve renderer, cancellation,
   provenance and pause regressions.
2. Complete Core ownership/stability audit, measured resource/performance pass,
   repeated Linux stress, aligned runtime/SDK/native identity verification and
   Railway Core smoke/soak using the actual candidate.
3. Publish Core `v1.18.33-bot.13-rc.1` only when those gates pass. Validate that
   exact RC, its install/upgrade path and realistic Railway soak. CI and smoke
   alone do not qualify as soak evidence.
4. Publish Core `v1.18.33-bot.13` only after thorough RC validation leaves no
   known high-severity blocker. Significant regressions require another RC and
   repeated verification; finalize public stable notes at this gate.
5. After Core stable, perform one clean Bot migration directly from pre.7 to
   stable: align all three artifacts, adopt renderer/pause/process/provenance,
   remove proven obsolete renderers/shims/ownership, audit every Bot→Core route,
   run the full Bot suite/CI and Railway production soak.

Core release readiness is assessed independently of the frozen Bot migration.
The final Core report must include tags/commits and release URLs, CI and Railway
RC soak evidence, measured resource results, ownership audit, documentation and
remaining non-blocking issues. No stable release is authorized by one green run.

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

### Remote MCP/OAuth candidate after PR26

See [remote MCP/OAuth ownership checkpoint](MCP_OAUTH_OWNERSHIP.md). Real SDK/HTTP
regressions confirm this remains a required production boundary. Its workspace
owner and callback-state correction is verified on `stabilize/core-mcp-lifetime`
at `e6bbabe` (PR27): cumulative CI, five Linux rounds/1,100 passes and actual
compiled Railway six surface/eight execution tests are green. The duplicate
cancelled Railway commit context is documented separately; it is not a live
runtime failure. Broader crash/concurrency/resource gates remain open. Bot and
releases remain frozen.


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


### Railway containment boundary continuation (2026-10-04)

[The compiled/Railway investigation](RAILWAY_CONTAINMENT_BOUNDARY.md) separates
normal escaped-tree retirement from runtime/container failure. Actual Railway
primary-Bun SIGKILL and platform restart demonstrate namespace teardown, while
child-Bun replacement beneath a live parent and normal successful custom-tool
double-fork retirement still strand processes. Runtime cgroup delegation is denied.
Hard-crash containment belongs to a proven essential-child container contract; the
frozen Bot currently respawns Bun inside its surviving Node container, so adoption
is a separate deployment/integration prerequisite. No Core supervisor was shipped,
no Bot change was made, and no current process RC blocker is declared closed.
Persistent browser lifetime still requires a durable workspace service authority
and actual pinned-browser validation; a launcher lease is insufficient. The report
records remaining epoch/overlap fencing and the classified/unfinished test evidence.
This supersedes earlier pending/blanket in-Core crash-gate statements, not previously
verified credential/plugin/shutdown/MCP/shell invariants or removed-surface scope.


### Current containment gate status (2026-10-04)

This supersedes the earlier pending browser/group-only/crash statements and
checklist percentages. Credential serialization, joined plugin retirement,
uncertain shutdown propagation, required credential HTTP transport, MCP OAuth,
optional AWS/Azure fail-closed policy and previous isolation/pause gates remain
verified; they are not reopened.

The cumulative Core candidate implements a bounded external native scope runner
under the existing lease and a captured persistent foreground browser service.
Actual compiled Linux and Railway tests prove ordinary escaped/double-fork tree
retirement, physical pause/resume/abort, workspace replacement, same-browser reuse
and joined Chromium/crashpad/private-file cleanup. Static runner packaging works
in the Bot's Bookworm libc environment. Direct owned-daemon IPC avoids per-call
Node launchers. The 1GB Railway fixture uses one resident browser plus foreign-topic
governed work; a second browser may be correctly rejected by admission. Local
higher-capacity two-browser isolation remains verified.

Runtime/runner loss belongs to the essential-container boundary. Actual Railway
UID1000/dumb-init tests prove Core75 on runner loss, Bun SIGKILL, independent
namespace witness termination, mounted-volume old-writer fencing, and persisted
pause recovery as continuation-unavailable with stale resume rejected. No larger
Core supervisor or recursively guarded authority is needed. The supported contract
is one container/replica with its volume, essential Core loss ending the container,
and no replacement Bun below a surviving parent. Cgroup delegation/nested namespace
operations are unavailable in the actual candidate.

The frozen Bot does not yet adopt that contract or the browser/custom-process
capabilities. These remain real production integration blockers, separately scoped
in [the concrete prerequisite](BOT_CONTAINMENT_PREREQUISITE.md). Candidate evidence
cannot certify unchanged Bot code. PR28 remains Draft; no RC/stable, Bot pin,
deployment or migration is changed. After adoption, the shortest justified rc.1
path is the combined required Telegram workload/failure gate and aligned exact
source/artifact/CI/Railway verification. Stable additionally requires its soak and
operator rollback evidence. See [the boundary report](RAILWAY_CONTAINMENT_BOUNDARY.md)
and its retained physical experiments for exact source/digest/deployment details.
