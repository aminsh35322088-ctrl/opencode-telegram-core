# Telegram process containment: Railway boundary investigation

2026-10-04 continuation of draft PR28. Runtime under test:
`8f90bdff019335e2e2500b33fa07598b786bffc3`. No production supervisor, Bot change,
release, pin or migration is included. This report supersedes the earlier assumption
that every hard-crash guarantee must be implemented inside Core.

## Recovered state

The attached Cloud environment was fresh: `/workspace`, its shared/scratch/library
storage and standard `/tmp`, `/home`, `/root`, `/opt` locations contained no Git
checkout. There was no prior local status, HEAD, reflog, worktree or dirty tree to
recover. This does **not** establish that the previous VM had no unpushed work.
VM-only work from that session is unavailable here. The repository was cloned and
checked out at the exact supplied PR head; its initial status was clean, with one
worktree and only clone/checkout reflog entries. Main remains `884ae87d…`, PR28 is
Draft/unmerged, and published pre.9 remains `28e7527…`.

PR28, all five requested lifecycle/release/credential/migration documents, the
classified diagnostics and the Railway harness were reread. CI37192038707 has
validate, upstream-runtime and telegram-headless green. Deployment
`b7a0f971-c1c9-4ace-9b83-a64bfefdbebb` reports the exact source and binary SHA256
`15556672ad7579b13abf25b186cf5711aae147d4e8003cc0c069521a58355104`.
The preserved baseline has1,066 sequential workloads/no failures; this is not a
concurrency, crash or RC-soak gate. [Baseline evidence](../validation/containment/railway-baseline-8f90bdf.json).

## Observed process semantics

The [unshipped probe](../tests/diagnostics/railway-boundary/probe.py) uses the real
compiled artifact, loopback model/API fixtures, PID/start-time/session/group identity,
physical Linux T-state acknowledgment, causal descendant readiness, and explicit
identity-fenced fixture cleanup. Its external, bounded
[heartbeat receiver](../tests/diagnostics/railway-boundary/witness.ts) survives the
candidate's restarts. No process governor or production cleanup was changed.

| Case | Observed outcome | Implication |
| --- | --- | --- |
| Normal Bun SIGTERM with physically paused shell | Shell disappears; Bun exits0 | Existing joined normal shell retirement remains valid |
| Child Bun SIGKILL beneath a surviving wrapper | Same stopped shell is reparented to PID1 | tini reaps **dead** orphans; it does not kill live orphan trees merely because a non-primary child dies |
| Replacement Bun in the same container | Same stopped shell survives replacement readiness | Listener/PID replacement is not containment or durable fencing |
| Compiled governed custom-tool double-fork/setsid | Tool succeeds; global.dispose returns true; grandchild remains live under PID1 | Process-group retirement is not full-tree retirement, even without a crash |
| Forced exit73 of tini's direct child, without any cleanup | Old heartbeat stops; new boot/PID namespace appears | Death of the primary authority can end the whole namespace; no recursive guardian is needed for this outer boundary |
| Platform-requested restart | Live old heartbeat stops; replacement uses another namespace | Platform container teardown supplies a real outer containment boundary |
| Compiled Bun as tini's direct child, SIGKILL after HTTP readiness | Exact primary identity killed; old heartbeat stops; replacement namespace appears | The simplest crash contract is viable on Railway: make Bun the essential container child |
| SIGKILL sent to PID1 from inside its own namespace | Signal syscall succeeds, but init stays alive and heartbeats continue | Invalid container-kill injection; namespace init signal protection must not be mistaken for teardown |

[Local compiled observations](../validation/containment/local-8f90bdf.json),
[Railway live-tree failures](../validation/containment/railway-live-boundary-8f90bdf.json),
[primary-Bun setup](../validation/containment/railway-primary-boundary-8f90bdf.json),
and [external crash observations](../validation/containment/railway-crash-witness-8f90bdf.json)
preserve the identities and timestamps. The heartbeat is a detached/double-fork
**fixture**, not a Chromium execution test. The paused shell and successful custom
tool are actual compiled model execution. Observer silence alone is insufficient:
accepted cases require fresh pre-action heartbeats, action before fixture expiry,
a new namespace, and a continuing independent observer. This is bounded behavioral
evidence plus Linux PID-namespace semantics, not a host/kernel-failure guarantee.

### Actual available kernel boundary

The candidate's cgroup2 mount is read-only. Creating even an empty diagnostic child
cgroup fails with EROFS30; cgroup.procs/freeze/kill are not writable. Presence of
freeze/kill files is not delegation. A proposed in-Core per-workspace cgroup manager
cannot run under this contract. Do not request broader privileges just to preserve
that proposal.

The candidate has seccomp filtering, lacks CAP_SYS_ADMIN, denies the tested combined
user/PID/mount unshare with EACCES13 and setns to its own PID namespace with EPERM1.
The Cloud executor allows the unshare probe, demonstrating why Cloud results cannot
establish Railway support. The actual ordinary fork/setsid/double-fork descendants
stay inside the container PID namespace. These operations escape groups, not the
namespace. No supported host namespace descriptors, privileged host access or
writable host cgroup are part of the deployment contract. This is not an audit of
malicious kernel exploits or every possible namespace syscall.

## Boundary decision and scope

**Own hard runtime crashes at the deployment/container boundary.** The tested minimal
contract is `tini -s -> exec compiled Bun` as the container's essential child. Bun
failure must end that container epoch; restart occurs in a fresh namespace, rather
than launching another Bun under a surviving Node/Python parent. The same boundary
contains detached descendants and physically stopped groups. Core cannot run a
finalizer after its own SIGKILL, and adding another in-Core authority does not fix
that fact.

This requires a narrowly separated deployment/integration prerequisite. The frozen
Bot at `471f644a…` uses dumb-init, runs Node as its long-lived main application, and
its `src/opencode/auto-restart.ts` immediately respawns Bun inside that container.
`src/opencode/process.ts` stops the listener PID, not an entire container epoch.
That contract is the demonstrated unsafe child-Bun case. **The current Bot contract
is not declared crash-contained.** Its dumb-init behavior was not fault-injected;
the actual candidate uses tini. A separate Core container with Bun as its essential
child avoids changing Bot into a new init system or forcing every Core crash to
restart Bot-owned Tailscale/SSH. Adopting that boundary needs explicit integration
work later; no Bot code, configuration, pins, deployment or migration was changed.

Core still owns normal abort/retirement, logical run/session/workspace isolation,
startup publication, admission leases, joined resource cleanup and uncertainty.
Container teardown does **not** close the reproduced false success after custom-tool
completion/global.dispose while Core stays alive. Resetting a shared container on
every successful tool call would violate required concurrent/service semantics.

Compare the alternatives before further implementation:

| Mechanism | Fit / failure mode |
| --- | --- |
| More Core process-group cleanup | Necessary for existing normal groups, insufficient after setsid/double-fork and impossible after Bun SIGKILL |
| Existing single global subreaper/pidfd prototype | Previously retires descendants while alive; its own death strands them beneath a surviving parent; remains unshipped |
| In-runtime delegated cgroups | Useful if available, but denied by the actual Railway mount/delegation contract |
| Unprivileged nested namespace wrapper | Not established on Railway; the tested namespace creation fails, so Cloud success cannot justify shipping it |
| Whole Core container/init | Proven outer crash boundary under essential-child contract; too coarse for normal per-invocation/per-workspace retirement |
| Small external scoped process runner + container failure fallback | A candidate for live-tree retirement, not yet proven. It must be a mechanical adapter to Core's existing owner/lease, supply explicit confirmed retirement, and cause fail-closed container retirement on lost/uncertain runner authority; no guardian-of-guardian hierarchy |
| Platform-owned per-resource/workspace containers | Can supply tree scopes outside the read-only runtime; provisioning, routing, resources and consumer integration would be a separate prerequisite, not an assumed existing capability |

No live-tree runner implementation is selected or promoted by this investigation.
First establish the primary-container crash contract. Then choose the smallest
scoped adapter that demonstrates normal escape retirement, scope death and
replacement fencing in that deployment. Prefer an existing maintained runner where
possible; compare its packaging and failure fallback with platform-owned scopes.
Do not manufacture a larger Core supervisor to hide the integration prerequisite.

### Persistent browser and durable authority

A browser tree can use the **same outer container crash boundary**: Playwright's
setsid/detached daemonization does not move it outside the namespace. The pinned
Playwright implementation inspection remains valid. Actual pinned Chromium was not
installed or run in this candidate, so browser execution closure remains unproven.

For normal lifetime, represent a named browser as a workspace-owned service, with
its own captured epoch/handle/protocol identity and admission held across launcher
exit and multiple invocations. An invocation delegates work; it does not become the
persistent tree's owner. Register before daemon startup, fence late publication,
join protocol close and full-tree retirement, and quarantine uncertainty. No shared
browser may be globally SIGSTOPed because one topic pauses. Browser service work
and True Pause/Resume request isolation still need deterministic validation.

Persisted names, paths, sockets and PID files are discovery data, not authority.
Restart must mint a runtime/container epoch and reject stale run generations,
workspace/browser handles, callbacks, scheduled results and resume intent until
reconciled against that epoch. Never authorize from current topic lookup, a listener
PID or a saved PID alone. Serialize replacement/volume access against old epoch
retirement, including deployment overlap: fresh namespace startup alone does not
prove an older overlapping container stopped writing shared data. Retire/revoke
protocol access and fence persistent state before admitting replacement. A durable
lease/epoch must not mark success based only on guardian exit or launcher completion.
Existing credential/workspace/run fixes are preserved; cross-runtime service epoch
and overlapping-container fencing are not claimed implemented by this report.

## Validation limitations and failed experiments

- Redeploying an old Railway build uses its old snapshot: an initial redeploy kept
  the original harness despite changed service startCommand. Source connections
  were SKIPPED by manual-only watch paths; explicit redeploy of the new skipped
  snapshot applied the diagnostic config. No Bot service was touched.
- An initial startCommand override bypassed Docker ENTRYPOINT and made Python PID1.
  The normal-retirement observation then failed on unreaped identity. The corrected
  command explicitly includes tini; production group/death assertions were not
  weakened. That invalid run is not a crash pass.
- One early wrapper-exit observation occurred after the120s heartbeat expired.
  It cannot prove descendant death and is excluded. Fresh coordinated cases place
  the action before expiry; v2 allows300s and protects detailed HTTP evidence.
- Local compiled surface:6/6 pass. A production-execution run without an outer test
  subreaper:14 pass, MCP stdio disconnect errors; local PID1 is tail and leaves the
  captured sleep zombie. Correcting reaping lets that assertion pass, but that full
  run has14 pass/one HTTP500 during repeated MCP OAuth authorization. The focused
  OAuth case subsequently passes1/1. An additional instrumented full run, retaining server log files, passes15/15
  but does not reproduce/classify the earlier500. That pass does not establish
  root-cause closure: the original failure is **not** dismissed as infrastructure.
  No production fix or new RC blocker is inferred from the later passes. Retain
  this validation anomaly for focused log collection before final RC gates.
- CI at the tested runtime source is green; original/restored Railway harness checks
  are independent evidence. No cumulative source gate was repeatedly run to seek
  a green count. No concurrency/resource/RC soak closure is claimed.

## Release-gate adjustment and shortest path

Closed by this continuation: the **boundary feasibility question** for primary-Bun
hard-crash containment on Railway; unavailability of runtime cgroup delegation is
now experimentally established. These are architecture findings, not shipped
correctness fixes. No existing process RC blocker is declared closed for the current
Bot/deployment integration.

Remaining required obligations are:

1. Adopt/prove the essential-child Core deployment contract and durable restart /
   overlapping epoch fencing in a separately authorized integration prerequisite.
2. Close normal escaped-tree retirement and uncertainty for retained process paths;
   bind persistent Playwright to a durable workspace service authority and test its
   real pinned daemon/browser, service shutdown and request pause/isolation.
3. Finish retained helper/extension spawner audit, classify the local OAuth500,
   run the cumulative gate at the resulting meaningful implementation checkpoint,
   and exercise compiled concurrent/failure/resource workloads on Railway.
4. Produce aligned runtime/SDK/native/checksum artifacts from that exact green
   candidate, then rc.1; stable still requires RC soak and rollback/recovery evidence.

Credential serialization, joined plugin retirement/quarantine, shutdown-failure
reporting, required credential PUT/DELETE, AWS/Azure optional-helper exclusions,
MCP/OAuth fixes and earlier shell/pause/isolation gates are not reopened by this
architectural result. ProviderAuth/PTY/UI/v2/removed upstream surfaces add no gates.
No prerelease/RC/stable was published. The shortest justified next step is the
separated deployment contract, not another Core guardian layer.

### Restored candidate and checkpoint validation

The original compiled validation harness was restored from the initial build.
Deployment `a3e988c5-5701-4f43-ad9d-c62ea0748bbf` is SUCCESS, runs6 surface/15
execution tests with zero failures, and reports the original8f90bdf source and
`15556672…` artifact digest. Its recorded first16 workloads have no failures.
The temporary witness service was removed after sanitized evidence was saved.
The candidate remains pinned to8f90bdf; diagnostic/documentation successor commits
do not have successor-source Railway compilation claims. The start override is
cleared (empty/default); source/build/watch/domain/variable settings are preserved.
Bot deployment remains `4c21d27a-6a1f-4d8e-8864-8f70686bec29`.

Local toolchain verification:25 tests, one expected missing-PATH-Bun skip, no
failures; source/JSON/helper-template syntax and whitespace checks pass. Local
compiled binaries retain8f90bdf build identity; local artifact SHA256 differs from
Railway as already permitted by the reproducible-source/artifact contract. Full
local failure history above is preserved, not replaced by a final green count.

## Active continuation: live scope candidate (2026-10-04)

The candidate now embeds a bounded Linux scope runner in the headless artifact.
Existing custom-tool, execution shell and workspace service owners retain their
leases until a private Unix socket delivers waitpid/ECHILD confirmation and child
close is joined. Scope loss requests fatal Core exit75; this is **not a deployment
closure** while Bot still restarts Bun inside its existing container. The validation
wrapper now makes its steady compiled runtime essential: unexpected runtime exit
retires the wrapper/container instead of merely recording a failed workload.
No Bot changes or new release have occurred.

Focused Core tests pass28 with one unsupported-Windows skip; typechecking passes.
The real Linux probe passes five cases, including the expected survivor after
runner SIGKILL. Pinned Playwright has a foreground cliDaemon entrypoint. Three CLI
calls retain one browser identity; all11 daemon/Chromium/crashpad processes pause,
and paused retirement confirms all identities gone. Two escaped crashpad processes
are adopted. This proves feasibility of an existing workspace service owner;
its captured topic/service API, durable naming/fencing and Bot adoption remain work.

An FD prototype is deliberately retained as unshipped diagnostic evidence: Bun
extra stdio streams intermittently lost final receipts. The candidate uses an
independent private Unix socket and preserves ordinary child stdio. Integration
also preserves missing-executable errors after confirmed cleanup and avoids
waiting forever for a spawn notification already observed by Bun. Shell tests
now verify the actual workload leader and descendant are stopped; the runner must
remain awake to process resume/retirement. Stale-handle tests use actual retired
scope identity, alongside the existing synthetic group-identity tests.

Fixed-count compiled OAuth experiments at8f90bdf reproduce two token-socket errors
in12 Python-default-HTTP/1.0 cases, both correctly failed closed. Explicit HTTP/1.1
passes12/12. A reduction without Core reproduces the socket failure in Bun1.3.14;
500 HTTP/1.1 POSTs pass. The fixture now declares its HTTP/1.1 connection contract.
This classifies a transport-dependent fixture anomaly, not a token retry fix.
The earlier HTTP500 body was not captured; do not rewrite it as directly proven
identical. The next compiled checkpoint must validate repeated authorization and
failure fencing with retained logs. Evidence: `validation/containment/continuation-scope-local.json`.

### Persistent browser and required helper implementation checkpoint

The continuation now adds a captured workspace/session browser capability. It uses
the deployment's existing @playwright/cli0.1.18 / playwright-core1.63.0-alpha-2026-08-05
foreground daemon, fresh private daemon identity/config/cache, exclusive topic
ownership, serialized calls and physical idle parking. New execution generations
can delegate to the same browser; an old invocation cannot acquire it. Workspace
retirement joins the daemon/Chromium/crashpad tree. No session discovery file grants
authority and no shared browser is stopped for a foreign topic. Required budgeted
Linux helpers now use the same transient tree retirement as shells/custom tools.

Focused source tests:40 pass,1 unsupported-platform skip,0 fail. They include actual
setsid/double-fork helper retirement, missing-executable error transport, physical
shell pause/cancellation and browser authority rejection. A local actual-browser
source experiment confirms repeated calls/new-generation handoff. The compiled
browser diagnostic and exact-head Railway verification are pending; this checkpoint
does not claim their results or close the Bot adoption/container crash prerequisite.
The validation image now includes the Bot's exact pinned browser dependencies.
