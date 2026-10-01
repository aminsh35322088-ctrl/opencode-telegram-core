# Core-first migration and release gates

Status: migration in progress; neither architecture nor release candidate is yet considered stable.

## Ownership and implementation plan

All runtime implementations below belong in this repository. Bot changes are limited to consuming the verified Core release and replacing migrated calls.

1. **Reusable polling:** add `runtime/src/runtime/result-poller.ts`, export it, and expose it through `OpenCodeTaskContext.poll`. An immutable run identity is checked before and after every asynchronous read. Reads use an abort signal; sleep, attempts and overall duration are bounded. Pending, completed and failed outcomes are explicit. Write cancellation, deadline, stale-result, attempt-bound and concurrent-Topic tests before implementation. Replace scheduled-task looping only after the Core artifact passes verification.
2. **Pause/resume:** add cooperative gates to the upstream session execution graph and parent/child scheduler, then expose the verified capability through the Core SDK/native worker. Pause preserves the current logical run, fibers and sessions. Gates block new model/tool steps and delivery; supported owned processes are suspended and resumed. Abort interrupts and terminates. Persist enough paused intent to recover fail-closed after restart without silently replaying tools. Replace Bot abort-and-reprompt behavior only after runtime tests pass.
3. **Custom-tool processes:** expose the existing upstream process governor to custom tools through their runtime context. Every child lease carries its session/run/workspace owner, signal and lifecycle; a tool cannot provide an alternate owner. Bind process groups to the lease, propagate parent pause/resume and abort, and release on exit. Ownership loss terminates descendants. Keep existing Railway category/global/memory limits authoritative; do not create a Bot substitute.

Use focused changes and red/green regression tests per task. Keep SDK, native library and Linux runtime aligned in each immutable prerelease. Document API changes and migration notes in README/CHANGELOG; final public release notes remain deferred.

The unreleased [custom-tool process contract](CUSTOM_TOOL_PROCESSES.md) now reaches
the existing plugin registry using captured runtime context and the authoritative
governor. Portable and Linux process-group regressions cover ownership, pause,
cancellation and admission races. Persistent-daemon ownership remains a blocker
before complete Bot tool migration and release.

### Pause integration boundaries

The Bot currently uses the upstream legacy `SessionPrompt`/`SessionRunState` execution path. Live gates now integrate there in unreleased source, with the runtime control API, model phase fencing, and retained background task ownership covered by Core tests. See [the pause contract and remaining gates](PAUSE_RESUME.md). The shared execution authority runs in the upstream runtime; native clients consume its API. The published Bot pin remains pre.7 while native/process/delivery integration is incomplete.

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
- Verify delayed child events against their original logical run. Session ancestry alone cannot establish that a background child created in an earlier run belongs to a later run using the same root session. This remains part of the runtime integration and final routing audit.

## Review focus

- A read or process spawn finishes after its owner is rotated or deleted: reject output and clean the exact old child.
- A dependency ignores cancellation: enforce a bounded deadline without releasing a potentially live ownership boundary as healthy.
- Pause races with a child start, abort or permission request: preserve children on pause and make abort authoritative.
- Runtime restarts while paused: recover paused intent without duplicating side effects or accepting the previous generation.
- Two Topics share a host: never share execution, process, polling, SSH permission or workspace state.

## Audit and stability matrix

Current stability gate: Linux validation reproduced intermittent stalls inside
`SessionPrompt.cancel` for a shell with a queued model turn and for an exclusive
shell. The complete suite can pass immediately before the focused repeat fails.
Five repetitions of those two cases now run after the upstream suite; test-only
watchdogs report the blocked caller stage and Linux child process state. A passing
rerun does not close this gate. A separate deterministic Runner regression now
covers cancellation when shell work ends without opening its readiness latch;
Core waits for readiness or shell completion before interrupting. This fix is not
yet evidence for the intermittent Linux stall. Identify and fix its cause before
claiming the runtime stable or deploying the pause migration to the Bot.

After all three tasks, audit both repositories for duplicated Core responsibilities, unjustified shims, bypass routes, ambiguous identity, General/ALL execution, stale/late delivery, lifecycle ownership and artifact identity.

The stability pass must exercise concurrent Topics/sub-agents; pause/resume and parent abort; rotate/delete and crash/recovery; request/transport failure; scheduled tasks; file/tool/SSH isolation; custom processes; polling cancellation/timeout; memory pressure; SQLite recovery and restarts. Run both complete CI suites, all builds, artifact/install verification and Railway Core smoke. A Windows directory-fsync limitation is not a Linux production workaround.

## Release sequence

1. Remain on `v1.18.33-bot.13-pre.x` while any migration blocker remains.
2. When the audit, stability matrix and both CI suites pass with clean repositories, prepare Core `v1.18.33-bot.13-rc.1` and Bot `1.0.0-rc.1`.
3. Deploy the RC to Railway and record real usage/soak evidence: versions/commit identities, duration, scenarios, crashes/restarts, resource trends, leaked processes/sessions and routing failures. Synthetic CI and smoke alone do not qualify as production soak.
4. Significant regressions require another prerelease/RC and repeat validation.
5. Stable publication is gated on no known high-severity blocker or architecture workaround, clean ownership, aligned artifacts, complete documentation and verified upgrade/install paths. Prepare final notes only at that gate, then publish Core `v1.18.33-bot.13`, verify the Bot's stable pin and full suite, and publish Bot `v1.0.0`.

No stable version is authorized by passing only an intermediate task. The final report must include RC evidence, release tags/URLs, both CI and Railway status, ownership diffs, tests, deletions, documentation and remaining issues.
