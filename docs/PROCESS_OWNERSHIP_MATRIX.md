# Core stabilization process ownership contract

> Current production scope: [Minimum Telegram release report](MINIMUM_TELEGRAM_RELEASE.md). Historical full-upstream gates below are superseded by the scoped correction at the end of this document.

Core main is frozen at `640becc950605790b1fff368557885833886704a`.
All remaining lifecycle work belongs on `stabilize/core-process-lifecycle` as one
cumulative, dependency-ordered stabilization phase. Bot source, pins, PR189 and
production remain frozen. No RC or stable release is authorized by a partial gate.

This matrix is the required contract for every process class. The evidence section
separates implemented behavior from remaining defects; a contract entry is not a
claim that its gate already passes.

## Owner identity and authority

An execution owner is Core's captured session/run/root/workspace identity, never an
owner supplied by a tool or reconstructed from the current session at signal time.
A workspace owner is one live Core workspace instance and its lifecycle epoch,
canonical directory and registered resources. Closing is irreversible for that
instance. A replacement gets a new owner; an old callback cannot acquire its owner.
Service ownership survives the tool/request that happens to start it.

The same shared workspace lifecycle must register acquisitions before asynchronous
startup, cancel/fence startup when closing, own handles before readiness, serialize
replacement against retirement and retain uncertain resources. Existing process
budget and process-group retirement primitives remain authoritative; adapters may
provide terminal observation, not invent another lifecycle or admission authority.

| Process class | Authoritative owner | Admission owner | Pause/resume authority | Abort/terminate authority | Process-group ownership |
| --- | --- | --- | --- | --- | --- |
| Manual/model shell | Captured Core execution owner, subordinated to its root | Core process governor shell lease bound to that exact execution/group | Captured execution lifecycle; SIGSTOP/SIGCONT on the same owned POSIX group; active deadlines freeze | Execution abort/ownership loss; workspace shutdown also joins retirement | Isolated Core-created group; leader and descendants remain owned until retirement |
| Custom-tool execFile | Captured invocation/execution/session and canonical workspace; tool cannot substitute an owner | Existing Core category/global/memory lease | Captured execution lifecycle, same process/group; no abort/replay to simulate resume | Invocation abort, owner loss and invocation completion cleanup | Core-created group, including descendants; no raw spawn fallback or daemon handoff |
| LSP | Shared Core workspace lifecycle; startup owner captured before download/install/launch | Existing LSP service lease plus bounded helper/startup admission until underlying acquisition settles | Workspace lifecycle controls the service; a model run cannot suspend a service shared by other runs. Execution-owned requests must retain their own pause fence | Workspace close/replacement/crash; initialization failure joins registered retirement | Core-created service/installer groups registered before handle/readiness return |
| MCP stdio | Shared Core workspace lifecycle; transport registered before SDK handshake | Existing MCP service lease; handshake does not transfer/release ownership | Workspace lifecycle controls the service; request pause belongs to its captured execution. Exclusive execution delegation requires explicit ownership, never inferred ancestry | Workspace close/disconnect/replacement; fatal transport failure quarantines; parent abort cancels its request without implicitly killing unrelated service users | Core-owned isolated service group; SDK framing is not spawning authority |
| PTY | Shared Core workspace lifecycle plus exact PTY identity | Existing PTY governor lease bound to the registered terminal/group | Exact terminal/workspace owner; execution delegation, if present, must be explicit and fenced. No global/topic-derived signal authority | Explicit remove, workspace close and owner loss; all join retirement | Verify adapter-created POSIX session/group before signaling; never assume negative leader PID is safe |
| Browser processes | Shared Core workspace lifecycle with explicit browser/service handle; browser invocation has a captured execution delegate | Existing approved category/global/memory lease covering full browser lifetime | Captured owner of browser work; only explicitly owned/exclusive process groups may receive OS pause/resume | Workspace close/owner loss/browser close; joined group and protocol teardown | Explicitly owned browser process tree/group; a short-lived open-url launcher does not establish browser ownership |
| Persistent daemons | Shared Core workspace lifecycle; registered service identity, not launcher/invocation lifetime | Existing appropriate service/category lease held for the entire daemon tree | Explicit service owner and any fenced execution delegation; no fabricated pause support for external/unowned services | Service stop, replacement, workspace close and ownership loss | Registered Core-owned group/tree only; detached daemon launch without transferable authoritative ownership is rejected |
| Utility/helper processes | Captured execution owner when performing execution work; otherwise captured workspace/startup owner or explicitly bounded Core operation | Existing utility/helper governor lease, with canonical operation owner | Execution-owned work follows execution pause; workspace-startup work follows workspace cancellation. Cleanup utilities retain destructive cleanup authority | Captured owner abort/close/deadline; cleanup operations can finish bounded retirement | Approved Core spawner; installer/service descendants use the shared service-group retirement primitive |

A shared workspace daemon must not be SIGSTOPed merely because one model run pauses.
That would let one Topic freeze another Topic's service. A paused request must cease
its own work and delivery without losing continuation. If a service cannot provide
that guarantee for delegated work, the unsupported pause boundary fails closed and
remains a release blocker; it must not be labeled supported by stopping a launcher.

## Retirement, restart and admission

“Confirmed retirement” means both the adapter's terminal/close notification and
confirmed death of every owned group/tree. Leader exit, a successful signal syscall,
an empty client registry or a closed Telegram view alone are insufficient.

| Process class | Cleanup completion condition | Uncertain-cleanup behavior | Restart/crash behavior | PID/group reuse fencing | Admission release condition |
| --- | --- | --- | --- | --- | --- |
| Manual/model shell | Terminal close plus owned group death within existing bounded cleanup | Retain lease and original authority; fence execution/workspace; propagate uncertainty | Live continuation is not recreated; recover paused intent fail-closed. Verify actual crash/restart kills or contains owned children | Immutable captured identity; retire signal authority before release; old handles cannot signal replacements | Only confirmed retirement, including descendants and cancellation finalizers |
| Custom-tool execFile | Output/terminal settled, owned group dead, invocation cleanup joined | Retain lease/quarantine; no raw spawn or alternate-owner fallback | No replay of side effects; interrupted invocation fails closed, and process tree must be contained/retired | Captured execution/group and memoized retirement; no later current-run lookup | Confirmed tree retirement and output/resource cleanup, never launcher/leader exit alone |
| LSP | Pending startup settled, protocol shutdown complete and all registered installer/server groups retired | Bound waiting; retain unresolved startup/service admission and owner; reject replacement/late launch | New workspace epoch starts only after safe retirement/containment. Old callbacks cannot publish into the new instance | Captured workspace epoch, exact handle/group, memoized cleanup; registration removed only on retirement | Service lease after confirmed group/terminal death; startup lease after underlying acquisition actually settles |
| MCP stdio | Pending handshake/request startup settled; protocol close and all owned groups retired | Retain failed transport/service identity and lease, withdraw tools/status, reject replacement | Reconnect is a new workspace/service identity after old retirement; persisted configuration is not live ownership | Exact transport/client/workspace identity; old callbacks cannot mutate replacement state | Confirmed group/terminal retirement, including failed handshake acquisitions |
| PTY | Terminal observer and verified group death joined before listener/state disposal | Retain terminal/group owner and lease; report failure; no best-effort remove that frees capacity | No silent reconstruction/replay of terminal; actual runtime crash containment/reaping must be verified | Adapter-verified group identity, immutable PTY/workspace epoch, retired write/signal handles | Only joined terminal/group retirement; leader onExit cannot release by itself |
| Browser processes | Protocol/session shutdown and owned browser tree/group retirement joined | Retain browser owner/lease; fence future launches; propagate failure | Actual runtime crash containment required; no recovery via a launcher or replay of user action | Exact registered browser/workspace identity; late browser callbacks fail closed | Entire owned browser tree retired; never open-url launcher completion or arbitrary success delay |
| Persistent daemons | Registered service protocol/terminal and full owned group/tree retirement | Quarantine and retain accounting/identity; bounded failure rather than detached success | Explicit crash containment/recovery policy; never claim a vanished in-memory launcher lease owns survivors | Captured service epoch/tree; retirement revokes handles before reuse | Confirmed full service retirement; no detached descendant or uncertain lease release |
| Utility/helper processes | Captured operation/acquisition settled and any registered group/terminal retired | Retain admission until raw acquisition/group actually settles; block late launch and replacement | Interrupted work is not replayed; installer/helpers follow workspace epoch and actual crash containment | Captured operation/workspace identity; cancellation checked before launch and after asynchronous preparation | Actual operation settlement plus registered child retirement; not cancellation of its observer alone |

On spawn failure before any OS child exists, admission may be released after the
failure is established and acquisition cleanup settles. After any launch, the same
retirement conditions apply. A hard runtime crash is not proven safe by an in-memory
finalizer: actual compiled-runtime/Railway containment, descendant death and reaping
are required evidence. Unsupported OS/group semantics fail closed.

## Current evidence and open gates

- Shell group pause/resume, abort while stopped, descendant retirement, immutable
  signal authority and output-reader cancellation have deterministic Linux coverage.
- Custom-tool execFile already captures execution ownership, bounds output/time,
  propagates pause/cancel and cleans invocation groups. Persistent daemon ownership
  cannot be inferred from this short-lived capability.
- LSP/MCP process-group retirement is implemented at the approved Process boundary.
  The preserved LSP workspace candidate passed full321 upstream, Core npm10,
  original cancellation repeats, additional70 Linux cases, CI and native Railway
  smoke. It is included in this stabilization checkpoint, not a separate release.
- Current MCP local candidate has three red/green regressions for late publication,
  overlapping replacement and capturing a disconnect target before its permit.
  These are prototypes to consolidate into the shared workspace lifecycle; current
  full verification/review is in progress. They do not close remote/OAuth ownership.
- **Open:** shared workspace startup/teardown primitive across every service, PTY
  joined cleanup, browser/persistent-daemon ownership, remote MCP/OAuth pending
  identity, actual runtime crash containment/reaping, cumulative gate, real resource
  measurements and actual Railway runtime soak.
- Browser open-url currently uses a launcher and a 500ms success timer; PTY teardown
  currently drops listeners and sends best-effort kill, and leader exit releases
  admission. These behaviors violate this contract and remain release blockers.

## Single stabilization phase and cumulative release gate

1. Fix the shared workspace acquisition/closing/retirement primitive; migrate the
   preserved LSP/MCP prototypes onto it and fence every late callback/launch.
2. Move PTY lifetime and adapter retirement onto that same lifecycle.
3. Move owned browser/persistent-service lifetime onto the same lifecycle; reject
   unsupported detached ownership instead of inventing a launcher lease.
4. Audit every production process creator/caller; no best-effort or detached cleanup
   outside Core authority, no governor bypass and no second admission registry.
5. Build one cumulative process-class regression suite. It includes every previously
   closed shell/custom-tool/renderer/pause/provenance invariant and all new service
   cases, including startup/close races, pause/abort, uncertainty, restart and reuse.
6. Repeated Linux stress against that cumulative gate. Any regression stops the next
   implementation step: reproduce, add a deterministic regression, fix the shared
   root and rerun the whole gate. No rerun-until-green acceptance.
7. Compile the actual headless runtime and exercise its real APIs/process tree,
   identity and startup/restart behavior. Native conformance smoke is additional
   evidence, not a substitute.
8. Measure idle/single/concurrent/fan-out/tool/shell/pause/event/render/scheduled
   workloads, process/worker counts, cleanup/restart latency and memory trends.
   Distinguish cgroup total/working set/RSS/page cache; compare before/after.
9. Final ownership audit and actual Railway compiled-runtime soak/resource evidence.
10. Build aligned runtime/SDK/native/checksum artifacts for
    `v1.18.33-bot.13-rc.1` only after all gates pass. Stable requires verified RC soak.

No new features, isolated fix PRs, Bot migration or intermediate Bot pin changes
belong in this phase. The stabilization branch is the cumulative review/checkpoint
unit; main remains frozen until that phase is ready for integration.

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
