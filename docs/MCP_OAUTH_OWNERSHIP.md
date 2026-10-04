# Remote MCP and OAuth ownership checkpoint

Base: main `d7dfe4be6bd8baca56b316a8b8a271af450aa85a` (PR26).
Published pre.9 remains `28e752722ac616a74fbaa5c38709fa4e39d87ea4`.
This branch is an unpublished candidate, not an RC-readiness claim. Bot is frozen.

## Demonstrated production defect

Remote MCP and manual OAuth start/callback are required by the controlled Add MCP
Server product flow. Automatic OS browser authentication is excluded from the
production graph; stabilizing an OS browser launcher is not part of this change.

The previous pending-transport map and persisted PKCE/nonce were keyed only by
server name. Real SDK/HTTP regressions demonstrated cross-workspace handshake
replacement, one workspace's disposal erasing another's flow, acceptance of a
callback without its originating state, and credentials written after retirement.
A further regression demonstrated reuse of an interrupted token exchange.
These are required production ownership boundaries, not upstream parity work.

## Candidate contract

- The existing MCP workspace state captures the original instance context and
  owns remote client/transport acquisition before asynchronous startup. Existing
  per-server operation serialization also covers auth start, callback and removal.
- Each handshake keeps its PKCE verifier and random nonce privately in memory.
  A callback requires the exact `oauthState` returned by `auth.start`; absent,
  replaced or cross-workspace identities fail before token exchange. An orphan
  callback is rejected before service-cache acquisition, so it cannot bootstrap
  configured remote services after retirement or restart.
- Remote requests compose the SDK signal with the captured workspace owner's
  abort signal. Underlying connect, fetch and credential operations stay tracked
  until their actual promise settles, even if their Effect observer is interrupted.
- Cleanup aborts requests, joins client/transport close and pending operations,
  and releases the owner only after confirmed retirement. Cleanup has a finite
  bound; failure retains the exact owner and blocks replacement. Workspace disposal
  propagates uncertainty to the existing registry quarantine (PR26).
- Pending flows expire after five minutes. Expiry targets the captured owner,
  never whatever same-name replacement is current when a timer callback runs.
- Token-exchange error or interruption retires that exact flow. A successful
  exchange checks ownership before commit, and credential mutations recheck inside
  the existing file lock after asynchronous reading. Existing credentials survive
  failed reauthentication. No unowned fallback transport is installed.
- Workspace services remain live during an individual run's pause/abort. Workspace
  retirement ends their authority; persistent configuration is not live ownership.
  Container restart discards handshakes; old callbacks cannot recreate them.

## Consumer compatibility

`POST /mcp/:name/auth/callback` now requires `{ code, oauthState }`.
The frozen Bot already retains and checks callback state locally, but its later
stable migration must forward that state to Core. No Bot source/pin change is
included here. Restarted clients must start a new flow, not reuse a saved nonce.

## Exact-candidate validation

Source candidate: `e6bbabe993607997fbcff39eb9d47812f6fc5b93`, PR27.

- Red/green: original cross-workspace/private-handshake, late credential write,
  interrupted exchange reuse and orphan callback bootstrap cases. Removing the
  post-read credential-file guard deterministically makes its regression fail.
- Existing real HTTP timeout exposed an SDK SSE startup promise that never rejects
  when EventSource closes. Captured-owner cancellation settles the adapter handshake;
  confirmed transport/request cleanup remains mandatory. The regression stays intact.
- Focused MCP: 74 pass, including eight workspace OAuth cases.
- `scripts/test-upstream-runtime.sh`: typecheck, SDK/consumer contract, ten Core
  helper tests, 362 upstream passes/two expected skips and five shell race repeats.
- Native: typecheck/299 passes. Python toolchain: 24 passes.
- GitHub CI [37169090937](https://github.com/aminsh35322088-ctrl/opencode-telegram-core/actions/runs/37169090937): all three jobs pass, including production graph/typecheck, actual compiled execution and independent compatibility CLI.
- Local exact-candidate production binary: eight execution tests pass, including
  three HTTP OAuth cases, physical pause/resume/abort, paused workspace replacement,
  custom tools, MCP stdio descendant cleanup and original event provenance.
- Repeated Linux production process gate: five rounds, 1,100 passes, five expected
  platform skips and zero failures across 36 files per round. This runs
  all production Telegram/LSP/MCP/process tests together, then the two original
  shell cancellation/admission cases in each round. The nine excluded CLI/UI tests
  remain in the independent upstream compatibility suite, not production.

### Actual compiled Railway

Deployment `c5843490-b2a2-425f-b8d4-c7913049ba42` reached SUCCESS, health passed,
and `/validation` reports exact candidate `e6bbabe`, not the native smoke server.
Six compiled surface tests and eight compiled execution tests pass, including
all three new OAuth HTTP cases. Binary size is 113,891,456 bytes; no size
optimization was attempted.

The candidate recorded 33 workload rounds over 512 seconds on the same
PID171, no failures and zero observed PPid descendants. RSS ranged
508,476–721,612 KiB, most recently 642,980 KiB. See the bounded
[checkpoint measurements](validation/mcp-ownership-checkpoint.json). RSS is process RSS,
not cgroup working set. The exposed harness does not separately sample
`memory.current`, `inactive_file` or page cache; a full resource gate is still open.
Platform service metrics showed a one-hour peak of 1.3727 GB during rollout, covering
multiple deployment lifetimes. It cannot be attributed to one candidate's working
set. Do not use that aggregate window as evidence of either an individual leak or
compliance with the one-GB envelope. Platform limits report 1 GB memory/two CPUs.

Before replacement, previous candidate `03f20bd` recorded 2,074 workload rounds over
32,268 seconds, same PID112, no failures and zero observed PPid descendants.
RSS ranged 515,920–857,208 KiB and continued reclaiming (latest 552,308 KiB).
That nine-hour observation belongs to the previous workspace fix, not OAuth.
Neither observation detects descendants reparented outside the PPid tree or proves
real concurrent fan-out, abrupt crash containment, container restart or full soak.

### Deployment-status distinction

Staging/committing the Railway source change created deployment `f357ffcd`; a
second explicit deploy created `c5843490`. The first was later removed and posted
GitHub's “Deployment cancelled” context after the second had succeeded. The
GitHub CI jobs are green, while that external context is stale/cancelled. Do not
call the combined status green or spoof the Railway context. Future candidate
configuration must trigger only one deployment; a staged commit already deploys.

### Remaining release gates

This closes the reproduced OAuth ownership defects, not every production lifetime.
Raw custom process/persistent-browser ownership, provider/plugin/helper acquisition,
independent crash containment/recovery, realistic concurrent resource measurements,
final ownership audit and aligned RC artifact/soak gates remain open. Bot is frozen;
pre.9 does not contain PR26 or this source correction. No RC or stable publication.

Production binary SHA256: `d60072ba949bc5dfe9cfd186364aaa9dfe51fe37da529ae1054be5a37aa159b0`.
