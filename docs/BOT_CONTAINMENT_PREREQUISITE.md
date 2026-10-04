# Frozen Bot integration prerequisite

The Core candidate closes ordinary scoped retirement and persistent browser
ownership. Production adoption needs a small Bot source change; the current frozen
Bot does not satisfy the essential-container contract. This is a reachable
correctness boundary, not upstream feature parity or a new Core supervisor.

## Exact source evidence

The running Bot deployment is `4c21d27a-6a1f-4d8e-8864-8f70686bec29`, source
`b66e96fa521793e0d020f27852b2bb1a9c30b3d4`. The read-only source checkout at
`471f644aefe44950f07c2e11effced4ffca7d525` has the same relevant behavior.
`src/opencode/auto-restart.ts` handles a managed child exit by starting another
Core beneath surviving Node. `src/opencode/process.ts` detaches that child.
`.opencode/tools/browser.ts` runs a short-lived raw Playwright CLI that creates
its own detached daemon. Other required custom tools also use raw execFile.
Bot pins, source, live deployment, volume and migration have not been changed.

Actual Railway evidence shows that child Bun SIGKILL beneath a surviving parent
can leave a physically paused shell alive. A replacement Bun cannot adopt it.
PID1 tini/dumb-init reaps dead orphans; reaping does not terminate live descendants.
The candidate's essential parent ending on Core/cleanup authority loss does end
that namespace, including a detached independent witness. Read-only cgroups and
denied namespace operations rule out delegated cgroups/nested namespaces here.

## Proposed separate draft scope

1. Treat the managed Core as essential in the supported Railway container. Capture
   child exit and spawn failure before any startup/readiness await, including exits
   during config/memory restart, monitor checks and shutdown. Nonzero exit, signal,
   exit75 or uncertain retirement ends the essential Bot process/container; never
   start another Bun beneath it. A deliberately joined normal exit0 may permit
   planned in-container replacement. Health failure alone is not proof of death;
   forced or unconfirmed listener cleanup must use container replacement. Preserve
   non-container behavior separately rather than broadening the Linux contract.
2. Route the existing browser action/session/argument/filename schema through
   captured `context.process.browser`. Remove raw CLI launchers and filesystem
   output preparation before the capability fence. Keep all23 actions and named
   persistent sessions. Keep the pinned full Chromium installation and paths.
3. Route retained required custom tool subprocesses through captured
   `context.process.execFile`, preserving arguments, bounded output/timeouts and
   cancellation. Helpers must carry the captured capability; no global owner
   lookup, raw process fallback or tool-selected identity. Bot-owned diagnostics
   and Tailscale remain separate Bot resources.
4. Validate a separate draft against the exact Core candidate: startup exit race,
   healthy SIGKILL, cleanup-runner loss75, planned exit0, forced retirement failure,
   paused browser/shell crash, topic/workspace replacement, and real persistent
   volume recovery under dumb-init/UID1000. Core's existing capability tests cannot
   prove adoption by an unchanged Bot tool.

This scope requires permission to lift the user's Bot source freeze. No deployment,
Core dependency pin change, release, production traffic or migration is part of
that draft. Do not invent an in-Core guardian to compensate for the missing outer
contract. Moving Core to a separate service would additionally require a shared
workspace/storage design and is larger than essential-child adoption here.

## Release consequence

Keep PR28 Draft and pre.9 unchanged. Candidate containment evidence is conditional
on essential-child and single-container-volume ownership. It does not certify the
frozen Bot graph. After the separate draft is authorized and verified, run the
combined required Telegram workload gate, align exact source/digests/installable
artifacts, and only then consider rc.1. Stable additionally requires the agreed RC
soak, resource/workload coverage and operator rollback evidence.
