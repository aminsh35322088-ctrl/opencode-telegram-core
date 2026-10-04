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

### Compiled browser and cumulative CI checkpoint:3c6919f

All three jobs in CI37218779716 pass at exact source
`3c6919fbb0ac8274bdc743276fb3fae123308269`. The original broader failures were
classified: fortified C rejected an unchecked write (fixed68731fd), pause tests
observed the runner instead of the workload, missing-executable settlement raced
the error receipt, and a synthetic legacy launcher mock no longer intercepted the
governed OS boundary. The updated tests retain physical stop/death, joined close,
error rejection, retained admission and immutable uncertainty checks.

The [actual compiled browser probe](../tests/diagnostics/linux-process-scope/compiled_browser.py)
passes with the exact pinned native Chromium installation. Its
[results](../validation/containment/compiled-browser-3c6919f.json) establish two
exclusive topic trees, new-generation reuse, physical idle parking, active pause,
foreign-topic requests while paused, same-daemon resume, paused abort, joined
workspace retirement and fresh authority after workspace replacement.44 captured
identities include renderer churn; the count is evidence, not a coverage target.

The probe exposed a real concurrent admission defect: a paused CLI request held
maxConcurrent1's generic helper slot. A separate private browser-client admission
class now allows one client per admitted browser (max2,64MiB reservation each).
Tool-supplied environment variables cannot select that class. Browser services are
bounded separately (max2,256MiB each). No request replay or daemon auto-adoption is
used. The fixture corrections (isolated browser-cache path, daemon versus runner
identity, response history and required abort runId) were observation/API contract
errors, not production failures; no token retry or pause relaxation was introduced.

The ordinary Core escaped-tree and persistent browser implementations now have
compiled/source evidence. Their outer crash fallback remains a release prerequisite
until exact-head Railway runner loss/Bun SIGKILL and the essential Bot integration
are validated. No current frozen Bot deployment is declared contained.

The next inspection found forced Chromium retirement leaves temporary profiles
outside the daemon authority's directory. This is a real bounded-disk cleanup
problem, despite confirmed process death. The browser now supplies private HOME,
TMPDIR and XDG paths; joined retirement removes the profiles/crash reports with
that private directory. Failed startup/admission also removes its unpublished
private files. The compiled probe now asserts profile placement and file removal;
its verification at the new implementation checkpoint is pending.

Railway's current plan caps this candidate at1GB; an attempted2GB allocation was
rejected by the platform and changed no service configuration. The first328b7ef
startup fails admission (not OOM): used594–601MiB plus the still-warm256MiB browser
reservation plus a64MiB CLI-client reservation predicts95.8–96.6%, above95%.
Inspection of the exact pinned daemon establishes that its listening receipt comes
**after** Chromium context creation and backend initialization. The browser now
settles that startup reservation on this causal receipt; actual cgroup usage remains
counted, the service admission remains held, and pressure ceilings stay unchanged.
Other process classes retain their existing warmup. Focused admission tests preserve
both the pressure rejection before readiness and retained browser accounting after
readiness. Exact-head compiled/Railway validation of this correction is pending.

A late browser-preparation pause was reproduced with a real Linux FIFO metadata
barrier and a native sleeping launcher: while the owner was already paused,
startup still acquired a browser admission and launched its process. The corrected
owner checks the captured pause/cancellation gate after asynchronous preparation,
immediately before native admission. The focused test now remains pending with no
process admission while paused and cancels cleanly. An in-flight explicit resume
also checks pause intent again and re-parks before continuing if pause won the
race. This changes the new browser path, not the previously verified shell/service
pause architecture. Source tests4/4 and production typechecking pass.


### Release artifact libc boundary

The Cloud/release-like build's native scope runner requires GLIBC_2.38, whereas
the supported Bookworm image supplies2.36. The actual newer-host runner fails
inside `python:3.11-slim-bookworm` with that missing version. A static build of
the same C source passes all five real Linux process probes in that container
and has no ELF interpreter. The embedded runner is now statically linked. Its
945,496-byte local artifact still requires the final compiled size/graph gates;
no dependency or supervisor is added to the running Bot image.

Latest recovered sourceb5cd4b1 is preserved remotely. CI37227720715 passes all
three jobs. The latest local compiled browser probe passes the same native
44-identity lifecycle/isolation cases, including private profile retirement.
Railway67500f0 andb5cd4b1 both pass6 surface/15 execution cases, then reject a
concurrent browser client at the existing memory-pressure fence. This is preserved
as a capacity failure, never rerun into a successful claim. A smaller diagnostic
log is being used to capture physical cgroup counters before teardown.


### One-gigabyte concurrent browser admission

Exact compileddda0dcc has CI37228360600 green, a115,943,552-byte runtime,
and passes6 surface/15 execution cases inside Bookworm when built on the newer
Cloud libc. Railway's native two-browser test remains red: a paused request retains
a large CLI-client Node process and its warm reservation, so another client is
correctly rejected by the existing95% pressure ceiling. The focused diagnostic
records used870MiB/reserve64MiB/predicted104.7%; after the rejected browser's joined
cleanup, physical memory is709,242,880 bytes, with only11,493,376 inactive-file bytes.
That later observation is not the exact admission sample. It does not justify
blaming file cache or relaxing the pressure guard.

The pinned daemon already implements a newline-delimited private Unix-socket
`run` request. The candidate now captures its endpoint from that owned daemon's
startup receipt and sends the same parsed command directly from Core. There is no
per-call Node launcher, filesystem discovery/adoption, reconnect, retry or command
replay. The unused browser-client admission category is removed. Service leases
and physical pause/abort/retirement remain authoritative; request bytes, response
bytes, timeout and cancellation are bounded. Real Unix-socket tests pass7 across
transport/ownership/preparation, production typechecking passes, and the actual
pinned native browser source experiment retains the same daemon across generations.
Compiled and Railway validation of this simplification is pending.


### Capacity is distinct from retirement correctness

Sourcea2e1365 has all three CI37229278688 jobs green and passes the actual
compiled two-tree browser probe. Its direct transport removes both per-call
Node processes and the private client-admission class. Railway5a7dd24f correctly
rejects the second browser's256MiB startup reservation at used694MiB under its
954MiB/1GB limit (predicted99.6%, ceiling94%). The preserved failure confirms
that no second browser authority was published and the first remains owned.
This is a supported resource rejection, not a process-leak/ownership RC blocker.
A maxConcurrent ceiling never guarantees that every slot fits available memory.

The prior fixture incorrectly required two resident browsers on the1GB candidate.
The explicit Railway profile now tests one persistent browser, rejection of foreign
adoption, foreign-topic governed work during its physical pause, same-daemon resume,
paused abort, a different topic's subsequent browser, joined workspace retirement
and replacement authority. The compiled local two-tree test remains unchanged as
the higher-capacity isolation test. Both profiles pass locally on the exacta2e1365
compiled runtime. Railway verification of the bounded profile is pending; no
pressure ceiling/reservation/production capability has been weakened. Browser
evidence and physical resource counters will be retained in candidate health.


### Exact compiled Railway crash fallback:cbe49f5

Deployment0f1bb68a succeeds with compiled surface6/execution15 and the bounded
persistent-browser gate. Its binary SHA256 is
`e13128b66031384cd5fb2789d47ef435b2610ec0645711496a3774934a999887`
and size115,886,208 bytes. Preserved [browser evidence](../validation/containment/railway-browser-cbe49f5.json)
includes actual resource observations: paused-browser working set636,882,944 bytes
under memory.max999,997,440, foreign-topic work succeeds, and disposal removes all
44 captured/churn identities plus private profiles. This is a bounded gate, not
a concurrent two-browser capacity claim or long soak.

[Runner loss](../validation/containment/railway-runner-loss-cbe49f5.json) at3a9ab745
kills the captured runner of a physically stopped shell. Core exits75 because
confirmed-empty authority is lost; the essential wrapper exits and the independent
live namespace heartbeat stops (2,150ms observed silence while receiver stays live).
The namespace also contains11 parked daemon/Chromium/crashpad processes.
[Bun SIGKILL](../validation/containment/railway-bun-crash-cbe49f5.json) at48b89c27
produces runtime exit-9 and2,247ms independent silence under the same contract.
The replacement uses a new PID namespace and boot identity. Normal SIGTERM retires
the physically paused shell and exits0; successful double-fork execution retires
the grandchild before completion/global disposal.

No second guardian is added. The bounded runner can fail; its existing Core owner
fences uncertainty, and the already-proven essential-container boundary retires
that failure. Ordinary service/execution retirement has a scoped joined receipt;
hard runtime/cleanup-authority loss has a whole-container receipt. The frozen Bot
source still does not adopt that essential-child contract or browser capability.
Dumb-init/unprivileged and persistent-volume overlap checks are the next boundary
experiments, not claims inferred from these tini results.

CI37230057880 passes upstream-runtime/headless but validate fails a fixture integrity
check. The package fixture regenerated gzip tarballs on every request; a controlled
header-clock advance reproduces both retained-package hash failures deterministically.
Serving immutable bytes for each fixture URL fixes the cause: the same fixed-clock
locked-install test passes, including unchanged lock bytes and unavailable retired
package rejection. All25 toolchain/release tests pass. No dependency-integrity check,
lock, installation policy or product dependency is weakened. Successor CI is pending.


### Unprivileged init, mounted volume and durable recovery

CI37231081562 is green in all three jobs at bebfb152. Its immutable archive fixture
fix preserves lock/integrity policy. [Dumb-init runner-loss evidence](../validation/containment/railway-dumbinit-runner-loss-cbe49f5.json)
uses sourcecbe49f5/binarye13128b6 under UID/GID1000, empty effective capabilities,
real PID1dumb-init and su node. Normal SIGTERM empties a physically paused shell;
compiled successful double-fork completion/global.dispose empties its escaped
child. Killing the captured runner causes Core75 and2,196ms independent heartbeat
silence. [Bun SIGKILL with the mounted volume](../validation/containment/railway-dumbinit-bun-loss-cbe49f5.json)
causes exit-9 and2,300ms independent silence with11 parked browser processes.

[The persistent-volume experiment](../validation/containment/railway-volume-fencing-cbe49f5.json)
uses a disposable50MB Railway volume, one replica and the same unprivileged init
layout. A bounded double-fork writer physically appends/fsyncs to the mounted
journal and sends an external heartbeat; it is outside every Core scope and is
never explicitly killed by the fixture. A fresh writer was observed86ms before
the replacement preparation. Deploymentd0ea4c73 is replaced by8c96b201 while that
writer is live. The new boot records its start before Core opens persisted state.
The journal confirms old writes exist before index376 and zero old writes after
that new marker. Bun SIGKILL at8c96b201 followed by replacementf8ed4abb gives the
same result at index507. The receiver stays alive. This proves the tested
single-container-volume transition, not HA/multi-replica storage semantics.

The second replacement opens the prior real compiled session database from that
volume. Persisted pause intent reports the old run as paused/continuation-unavailable;
stale resume returns409, and an explicit owner-matched abort clears the intent.
[The local compiled recovery diagnostic](../validation/containment/compiled-persistent-recovery-cbe49f5.json)
also rejects stale pause/foreign abort, proves no implicit model replay, admits a
fresh owner only after abort, and rejects old abort against the fresh live run.
Existing durable pause and captured epoch fences suffice; no new authority journal
is introduced into production. Browser endpoints remain captured live receipts;
filesystem discovery is never restart authority.

Two unprivileged fixture errors are retained and classified: reading root init's
namespace link was denied, so the diagnostic records that link as unavailable and
uses its own namespace for setns testing. A generated volume-writer string had an
unescaped newline, producing no writes; those first two journal start records are
invalid containment evidence. The corrected fixture compiles its child command
and requires a causal write before readiness. Neither failed experiment is called
a production regression. Local recovery initially expected a completed execution
to stay live; the real contract releases it, so stale-owner protection is now
checked against a physically running fresh invocation. Public health reads during
replacement timed out; deployment readiness and exact authenticated evidence were
checked after routing switched, without rerunning a failed workload.

The selected architecture is a combination: Core owns admission, captured
execution/workspace epochs, persistent service identity and joined retirement;
a small mechanical scope runner handles live descendant topology; Railway's PID
namespace/init boundary handles loss of Core or cleanup authority. Read-only
cgroups and denied unshare/setns rule out delegated/nested containment here. A
larger supervisor adds failure authority without solving essential-parent loss.
Persistent Playwright uses the same scopes/container boundary with a workspace
service, not a launcher. The frozen Bot still respawns its managed Bun and launches
raw Playwright/custom tools: [the narrow adoption prerequisite](BOT_CONTAINMENT_PREREQUISITE.md)
is the remaining production integration gate. No Bot source/pin/deployment or
release is changed by these experiments.
