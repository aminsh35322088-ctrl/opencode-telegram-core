# Railway process containment continuation

The user requires closure of the remaining reachable Telegram release gates, with
production Bot deployment, pins and migration frozen. A narrow Bot source exception
has been requested because its current managed-Bun restart and raw Playwright tool
cross the unavoidable integration boundary. That exception is pending; independent
Core work continues. No RC/stable publication is authorized by this plan.

## Selected boundary

Railway has demonstrated whole PID namespace retirement when its essential process
exits, including SIGKILL. It has not demonstrated delegated writable cgroups or
nested runtime namespaces. Tini adoption alone does not kill living orphans.

Use the container for loss of runtime/cleanup authority. For ordinary live scope
retirement, evaluate a mechanical external subreaper runner attached to the
existing Core lease. A runner is not permitted to restart Bun or mint workspace
ownership. Confirm retirement only after waitpid reports ECHILD; loss of the
runner or its receipt is uncertainty, never successful disposal. Uncertainty must
fence admission and retire the essential runtime/container. Do not add a second
guardian. The current experiment remains diagnostic until compiled and Railway
failure tests and artifact packaging are complete.

Persistent Playwright should launch its exact pinned foreground cliDaemon entry
point under a workspace service lease. Its Chromium/crashpad tree can use the same
runner. A unique runtime/workspace/topic epoch must name the daemon and its state
paths; stale filesystem discovery cannot confer authority. Serialize requests per
browser scope and attach physical pause only to an exclusive topic-owned service.
Never stop a shared workspace browser for one topic. Repeated CLI calls must use
the captured daemon, never implicitly adopt/recreate one from old files.

## Implementation and evidence order

1. Preserve and classify fixed-count compiled OAuth failures. Compare identical
   fixtures with explicit HTTP/1.1 versus Python's implicit HTTP/1.0. Independently
   reduce Bun socket behavior, retain failures, and keep uncertain token exchange
   fail-closed. Fix the deterministic fixture if the reduction establishes cause.
2. Test a bounded external scope runner with real setsid, double-fork, thread-spawn,
   pause/resume, abort while paused, control EOF, leader failure and runner SIGKILL.
   Test actual pinned Playwright daemon, Chromium and adopted crashpad identities.
3. Embed the proven runner in the compiled artifact and reuse it in existing
   transient tool, shell and service spawn paths. Preserve stdio, output/error,
   budget accounting, captured execution epochs and joined disposal. Add a
   confirmed-empty receipt; uncertainty remains fenced and fatal under the
   supported essential-container contract. Do not enable an unproven runner.
4. Implement exclusive persistent service authority in the captured Core tool
   capability, using the foreground daemon and unique durable epochs. Confirm
   workspace deletion/replacement and repeated calls preserve/retire the right
   authority. Audit every retained process creator against the same boundary.
5. Prepare the separately authorized Bot integration draft: fatal whole-container
   recovery on unexpected managed Core loss, and browser capability adoption.
   Keep pins and production deployment frozen. Prove matching dumb-init behavior
   using a candidate, rather than mutate the running Bot.
6. Run focused compiled red/green tests before the cumulative gate. At the
   meaningful implementation checkpoint, run the cumulative gate once and
   classify any failures. Validate exact-head Railway scope loss, Bun SIGKILL,
   container restart, browser cleanup, overlap fencing and concurrent/resource
   workload. Preserve exact source/digest/deployment evidence.
7. Preserve commits in Draft PR #28 or a narrow prerequisite draft as appropriate,
   verify exact GitHub CI, and produce aligned installable artifacts only when
   useful. RC requires all supported gates closed; stable requires its own soak.
