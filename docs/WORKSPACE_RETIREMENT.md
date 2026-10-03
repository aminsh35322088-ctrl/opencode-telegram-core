# Shared workspace retirement investigation

## Verified foundation

PR #25 merged as `e5dd2b1bbebe5287b4621ca35ed07a4b91956234` after review of
its minimal Telegram composition. Its published pre.9 compatibility unit remains
`28e752722ac616a74fbaa5c38709fa4e39d87ea4`. The three CI jobs and isolated
Railway compiled-runtime validation belong to that candidate, not to the draft
retirement changes below. Bot source, pins and deployment remain frozen.

## Newly reproduced release blocker

The authoritative upstream paths are `src/effect/instance-registry.ts`,
`src/project/instance-store.ts` and `src/effect/instance-state.ts`.

* Registry disposal awaited `Promise.allSettled` but discarded failures. The store
  therefore emitted successful disposal and admitted replacement after uncertain
  service cleanup.
* `load` returned the existing context while its workspace was being disposed.
* A captured old `InstanceRef` could access service state by directory after a
  replacement, including after direct registry disposal.
* Reload did not settle its result deferred if retirement failed.
* Shutdown could stop at the first failing workspace and leave others untreated.

These are shared ownership failures, not PR #25 scope-reduction regressions.
The first five deterministic tests in `telegram-workspace-retirement.test.ts` failed
against the unmodified upstream implementations. They use public store/cache/
registry paths and controlled cleanup barriers, without timing sleeps.

## Draft correction and limits

Patch 0008 changes the existing ownership boundary rather than introducing another
process governor or a specialized service lifecycle. Workspace contexts register
before bootstrap; retirement revokes captured contexts and fences the directory.
The companion session-execution patch prevents retired idle callbacks from
reacquiring service caches or publishing state, while the existing workspace
finalizer still joins destructive execution/tool cleanup. All registered cleanup
is attempted. Failure propagates and retains the retirement
promise as a quarantine. Store loads/reloads reject closing or uncertain ownership;
reload failures settle their deferred result. Cache access checks the captured
context before and after acquisition. Shutdown attempts every workspace before
reporting failure.

Uncertain cleanup is not retried automatically: invalidated service caches cannot
prove that a subsequent empty cleanup means the original resource retired. Existing
process leases remain independently responsible for retaining uncertain admission.
A fresh runtime does not prove old OS processes died; crash containment and actual
container restart/recovery validation remain release gates.

Local validation of the current draft passed upstream typecheck, SDK build and
consumer-surface verification, 10 Core helper tests, 352 upstream tests (two
expected platform/projector skips), and all five original Linux shell race repeats.
Native typecheck/299 tests and 24 Python toolchain contracts also passed. Six
workspace regressions cover dispose/reload quarantine, load during closing,
retired-context access, direct registry disposal and reload versus pending bootstrap.
Review found the last two error-path/race gaps; the causal regression was red before
its correction. The uncertain LSP fixture now requires a bounded rejection and
observes its intentional scope failure, while retaining child-death, lease-retention,
late-launch rejection and eventual raw-acquisition settlement checks.

The first cumulative attempt exposed two failures: the old LSP successful-disposal
expectation, and an idle callback reacquiring retired session status during resource
cleanup. The second was corrected at the captured execution/workspace boundary;
the existing owned-resource termination regression passes unchanged. The initial
reload deferred error-path typecheck failure was corrected to the Effect v4 Exit API.

Five cumulative Linux stress rounds passed (425 passes, five expected skips), and
the original compiled production suite passed (six surface, four execution tests).
The correction has not yet been certified by cumulative CI or compiled Railway
execution. It is not an RC-readiness claim. Remote MCP/OAuth global pending flows,
raw custom-tool/persistent browser ownership, remaining helper/provider subprocess
review, hard-crash containment and broader resource/soak evidence remain open.
OAuth-only changes should follow this shared boundary rather than bypass it.

## Remaining ownership questions

This correction does not certify every asynchronous bootstrap/helper acquisition.
An interrupted observer must not be counted as raw startup settlement, and a blocked
bootstrap must not allow an unfenced late process launch. Existing LSP/raw-acquisition
regressions remain necessary, and plugin/provider/helper bootstrap paths still need
that audit. Remote MCP transport/OAuth lifetimes also remain outside the completed
boundary: the module-global pending map and callback reverse index are keyed by
server name and disposing one workspace clears other workspaces' pending flows.
They need workspace/flow ownership, abortable retirement and stale completion tests.

The live pre.9 Railway endpoint was independently read on 2026-10-03: exact source
`28e7527`, unchanged PID 95, 316 completed repeated two-session workloads, no recorded
failures and zero post-disposal descendants in the last ten samples. Those RSS
samples were 552512–626816 KiB, threads 7–9. This is a limited existing-fixture baseline,
not evidence for the new failure paths or a stable-release production soak.

## Compiled validation follow-up

GitHub run `37135625171` passed validate and upstream-runtime. Headless validation
passed the production artifact's surface/execution tests and the independent CLI's
10 historical v2 contracts, then failed two duplicated production-execution cases
against that full upstream CLI. Local diagnostic builds reproduced the failures.
The rejected disposer was specifically `httpapi/handlers/pty.ts` invalidating its
`LocationServiceMap`, with the normal run-retirement reason `execution finished`.
No InstanceState cache disposer rejected. This handler and its PTY/control-plane
service graph are excluded by the production profile and verified bundle graph;
production location services contain only Location/PluginInternal/Reference/PluginV2.
The release gate now tests production execution only on the shipping artifact,
while retaining the independent historical v2 suite. No cleanup error is suppressed
and no retired upstream surface is restored for parity.

A new compiled production test then exposed a separate, real blocker: global
workspace disposal while a model shell was physically paused timed out at the
existing 15-second request bound. Direct abort-after-pause already passed. The
shared runner scope joined model fibers before the execution finalizer terminated
owned processes, so physical close could wait for termination behind its own join.
A deterministic synthetic resource regression reproduced the same ordering failure
(0 pass, 1 timeout at 3 seconds) without sleeps. Work now has an explicitly owned
scope: the existing workspace finalizer revokes execution and terminates resources,
cancels runners, drains tools, and closes that scope, aggregating failures.
All 13 run-state tests pass locally after the correction. Cumulative CI, rebuilt
production execution and Railway evidence for this follow-up remain pending.

The follow-up cumulative gate at `48edf894` passed upstream typecheck, SDK surface,
10 Core helpers, 353 upstream tests/two expected skips and all five original
cancellation/admission repeats. Exact compiled production tests passed all five
execution cases after correcting the replacement probe to the supported model/tool
HTTP API (the manual-shell HTTP endpoint is deliberately excluded). The new case
verifies paused disposal, physical shell death, stale resume rejection and successful
replacement shell execution. Six compiled surface tests also passed. An overlapping
local typecheck initially saturated cgroup admission (`usedMb=7623`, limit 8192 MiB,
94% ceiling) and prevented process startup; validation was serialized rather than
changing governor limits. Current repeated Linux stress, CI and Railway remain
pending; this is not release certification.
