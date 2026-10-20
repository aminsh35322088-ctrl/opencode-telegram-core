## 1.18.33-bot.13-pre.40

### Scoped Railway access for Topic Workers

- Add a built-in read-only Railway tool for workspace/project/service inspection,
  recent deployment status, and bounded deployment logs.
- Route every request through the authenticated signed Worker-to-Control-Plane
  channel. Railway credentials remain exclusively in the privileged Control Plane.
- Restrict requests to the configured workspace and verify project, service,
  environment, and deployment ownership. Arbitrary GraphQL and mutation actions
  are not exposed to the model.
- Bound output and redact common secret/token patterns before returning logs or
  service metadata. No variable values are returned.

## 1.18.33-bot.13-pre.39

### Tailnet tag migration to tag:co-admin

- Topic Workers now advertise `tag:co-admin` instead of `tag:opencode-bot` when
  joining the tailnet, matching the operator-managed reusable auth key and the
  control-plane device's tag.
- Tailnet ACL and Tailscale SSH policies that previously allowed `tag:opencode-bot`
  should grant the same rights to `tag:co-admin`.

## 1.18.33-bot.13-pre.38

### Authenticated GitHub API for Topic Workers

- Topic Workers now expose the authenticated `github` tool backed by a local
  signed GitHub API proxy, so repository, issue, pull request, workflow, and
  check operations run with the operator's bot-token credentials instead of
  failing on unauthenticated rate limits.
- The Worker runtime ships `runtime_tools/github.ts` and the node agent wires
  the proxy into the Worker process, keeping credentials inside the control
  plane and out of prompt/tool payloads.

### Operator-approved Tailnet SSH from Workers

- Before a Worker opens a remote SSH connection through the `network` tool,
  the Telegram operator receives the classic Allow-for-this-Topic / Reject
  prompt in the Topic.
- An approval is required once per target host and user for the lifetime of
  the Worker process; a rejection aborts before any TCP connection is made.

## 1.18.33-bot.13-pre.37

### Worker execution recovery

- Fix a native execution lifecycle bug where a completed or failed model run left
  the Worker single-slot owner RUNNING. The following signed `run.prepare` then
  failed, even after the native Core execution had ended.
- Before admitting the next prepared run, reconcile the previous exact slot owner
  only after a session/run-scoped terminal event has been observed and the native
  execution endpoint confirms no execution exists. An expired, unconsumed prepare
  receipt can also be released without admitting model work.
- Apply the same reconciliation to authenticated idle status reads so Control can
  establish that the Worker is idle before recovering uncertain admission. Signed
  status distinguishes `pending` admission from explicit `idle`; an absent native
  runner alone is never treated as proof of completion.
- Recover inherited legacy run metadata before a newly spawned, supervised Core
  lease becomes ready: preserve recovered paused/native executions, require exact
  unchanged session/run identity and absent execution, and never apply this startup
  path to same-process accepted admission. This lets existing pre.34 Workers recover
  safely during an approved image rollout without deleting their Topic/workspace.
- Keep startup and retirement in the same Agent/admission-before-lifecycle lock
  order; a deterministic concurrent regression prevents a startup/retire deadlock.
- Revoke the completed run's MCP authority and clear its stale prepared/native
  run metadata while retaining the Topic session and workspace.
- Preserve live executions, accepted prompts still staging before runner
  registration, unexpired prepared admission, and callback ownership. Native
  streams require a start event before recording their terminal receipt.
  Inconsistent slot identity fails closed. No automatic provider retries or model
  changes are introduced.

### Verification and operational limits

- Red-first regressions reproduce second-request rejection after completion and
  a signed idle status that incorrectly left the Worker running.
- Regression coverage includes live-run preservation, prepared-run preservation,
  inconsistent owner rejection, accepted-but-still-staging admission, and the
  existing foreign-session/run boundaries.
- Release publication still requires successful Core CI and artifact verification.
- Existing deployed Worker images need an explicit rollout; publishing this
  prerelease does not update them. No Topic/session/workspace migration is needed.
- Provider free-tier eligibility is unchanged. A provider's client restriction
  must be handled by selecting an eligible configured provider; this release does
  not bypass that restriction or claim that every free model is usable.
- This is a prerelease. Stabilization gates remain unchanged and no Stable Bot or
  Stable Core release is claimed.

## 1.18.33-bot.13-pre.36 (2026-10-14)

Telegram presentation compatibility prerelease for Bot PR #191, based on Core
pre.35 and upstream OpenCode 1.18.33 (`51ef4be1d3c122f18fefb510dca8d778571f4f18`).

### Changes

- Core now renders ordinary GFM Markdown tables as compact Telegram tables. Header
  flags, alignment, cell contents, chunking and readable fallbacks retain their
  existing semantics. Explicit HTML tables remain non-compact unless their author
  supplies the `compact` attribute. This removes the need for a Bot-owned table override.
- Export `TELEGRAM_RICH_PRESENTATION_CAPABILITIES` and its key type from the native
  runtime Node artifact. The build-time contract describes Rich Messages, Details,
  expandable quotes, math, date/time, anchors, references, compact tables, trusted
  rich buttons and Persian/RTL bidi support. It is not Telegram-client negotiation.
- Add presentation ownership regressions for compact GFM tables, explicit HTML
  compactness and public capability exports. Document the Core/Bot ownership split
  and the required artifact-pin handoff for Bot #191.
- Prerelease automation now publishes the exact version's full changelog section
  and source revision, and fails if that version has no changelog entry.

### Compatibility and upgrade

- Runtime, SDK and native-runtime archives remain one verified compatibility unit.
  Consumers must pin the release's source commit and checksums together.
- Bot #191 must consume this release and the matching immutable Worker image, then
  pass its combined CI before deployment. Existing production Workers are not
  migrated by publishing this prerelease.
- Windows atomic binding-store replacement fixes from pre.35 are retained.

### Verification and limitations

- Core #31's reviewed feature head passed validate, upstream-runtime and
  telegram-headless CI, including 344 runtime tests and 326 Python tests. Publication
  additionally requires successful CI on the release source and verifies packaged
  runtime/SDK/native identity and every artifact checksum.
- This is a prerelease. Stabilization gates and the RC soak remain open; it makes
  no Stable-release claim. Deployment recovery is tracked separately from those gates.

## 1.18.33-bot.13-pre.30

- Added safe reusable Railway Worker generations across persistent volumes.
- Added retirement sanitization that wipes tenant state without deleting the Service or Volume.
- Enforced clean retired generation + rotated secret before bound/unbound identity rotation.

# Changelog

## 1.18.33-bot.13-pre.25

- Add signed, governed per-Topic `session.compact` with existing run preparation,
  cancellation, model selection, snapshot fencing and idempotent event callbacks.
- Native summarize accepts optional async admission while preserving synchronous
  SDK behavior and owned Core session execution.

## 1.18.33-bot.13-pre.17

- Report image-owned Core commit/version through authenticated Worker health.
- Publish a governed immutable Worker image through the existing verified release workflow.

## Unreleased

- Candidate plugin retirement attempts every disposer, bounds actual startup/cleanup settlement, and propagates uncertainty into workspace quarantine; compiled/cumulative validation is pending.

- Correct the minimal production profile to retain authenticated credential PUT/DELETE required by internal provider refresh plugins; provider sign-in and logging/control-plane APIs remain excluded.

- Production rejects optional AWS `credential_process` rather than launching an SDK-owned ungoverned shell; static profiles and non-process credential links remain supported. Exact compiled validation remains pending.

- Credential-store stabilization candidate: serialize shared provider credential reads and mutations with the existing file lock; retain provider/MCP mutation locks through admitted filesystem writes during cancellation. Fence excluded provider sign-in services in graph/compiled-route checks. Verification is in progress.

- Candidate remote MCP/OAuth ownership: scope handshakes to the original workspace, keep PKCE/nonce private, require callback state, abort and join remote requests before replacement, and fence credential writes inside the file lock. See `docs/MCP_OAUTH_OWNERSHIP.md` for validation and remaining gates; not yet published.

- Correct Telegram Core to the audited current Bot contract: 41 production endpoints, no full upstream parity. Exclude PTY, v2/workspace/control/UI routes, sharing, mDNS, Console integration, Code Mode/TypeScript and FFF native search; preserve required agent/MCP/LSP/files/plugin/native capabilities and all closed invariants.
- Freeze the model catalog for reproducible candidates; enforce graph exclusion and a 120 MB production budget. Add real compiled model/SSE/shell/MCP/auth regressions and a dedicated actual-runtime Railway validation image.
- Retain unused native v2 adapters and future live-control APIs only in compatibility/debug tooling. No Bot migration or RC/stable claim.

- Fence MCP local workspace teardown and serialize per-server replacements/disconnects; retain current ownership through joined cleanup.

- Fence closing LSP workspaces, own processes before initialization completes, and join pending acquisitions so teardown cannot publish or leak a late client.

- Enable process admission at standalone Telegram-headless server startup before loading runtime modules; inherited disabled flags cannot bypass the production governor.

- Route MCP stdio through Core-owned workspace process groups with SDK framing, joined cleanup and retained admission; remove SDK launcher lease and best-effort descendant cleanup.

- Governed LSP service shutdown joins isolated process-group cleanup and retains admission until terminal closure and confirmed death; failed cleanup keeps accounting.

- Attach governed manual/model shell process groups to captured execution ownership and phase for OS pause/resume and abort-after-pause. Join terminal close and confirmed group cleanup before releasing admission; retire signal authority before PID reuse.

- Make the actual ShellTool timeout consume active execution time, preserving parent/child continuation while paused.

## v1.18.33-bot.13-pre.8 (2026-10-02)

Verified aligned runtime/SDK/native prerelease from `f110bd25419b6bedc40db36e9ae929bc4e52b9ac`. Compatibility, identity and checksum verification passed in release workflow `36979098365`; these are not final v1 release notes.

- Enforce combined block/inline nesting and actual quote/container block costs, preserve credits within text budgets, account for cumulative table spans/rowspans and safely flatten oversized spanning tables.
- Port PR #15 onto current pause/process/provenance architecture without its superseded shell cancellation patch. Reject non-finite, fractional, non-positive and oversized renderer budgets; verify pause between final chunks retains the same owned draft.

- Capture original root/producer run provenance at Core event publication, preserve it through live SSE/global delivery and SDK schemas, and require it for native execution routing. Completion/cancellation snapshots retain retired ownership; ordinary completion honors pause even without pending tools. Bot adoption remains gated on a verified aligned prerelease.

- Settle Runner cancellation when shell work finishes without opening readiness; cancel queued work without retaining a dead wait.
- Share bounded process termination between scope cleanup and explicit kill, retain governor admission through uncertain cleanup and post-spawn errors, and preserve output completion at `close`. Make output-reader listener attachment and cleanup registration atomic with cancellation, preventing a leaked reader from suppressing Linux/Bun terminal close. Deterministic reader-acquisition regression, Linux stress, CI and exact-candidate Railway health verification passed.

- Add a Core-owned Telegram-native document renderer: parse GFM plus Telegram Rich Markdown/HTML into semantic `AgentDocument` blocks, including math, custom emoji/time, references/anchors, media/figures, rich tables/lists, expandable quotes, details, collage/slideshow, maps and trusted interactive buttons; sanitize unsafe/untrusted links and actions, normalize Telegram Rich Message limits, and chunk final responses without breaking code, tables, lists, captions, credits, or grapheme clusters.
- Add Persian/RTL BiDi normalization for mixed-script output: auto-detect document direction, isolate LTR/RTL inline runs with Unicode LRI/RLI/PDI controls, align table cells by content direction, preserve code bytes, strip untrusted BiDi controls from prose, and mark streamed Persian Rich Markdown drafts as RTL.
- Persist finalized Markdown as explicit Telegram Rich Blocks while retaining native Rich Markdown for incremental draft streaming and exact-run Stop fencing.
- Fix deadline handling so pre-aborted parents cannot start work and cancellation rejects uncooperative requests promptly.
- Document the remaining pause/process migration, ownership audit and RC/soak/stable release gates.
- Full Bot pause/process adoption, intended shell-process suspension and persistent-daemon lifecycle remain release gates.
- Integrate live pause gates into the existing upstream session runners, model streams, tool bridges, and child scheduler; retain background ownership through follow-up delivery.
- Add run-fenced runtime pause/resume controls, protected recovery intent, workspace checks, and destructive cleanup before session deletion.
- Fence earlier model phases and ensure workspace disposal attempts all resource cleanup after runner errors.
- Add actual upstream runtime/API regressions and generated SDK wire-contract checks to CI. Full Bot delivery/control and custom-process adoption remain incomplete.
- Settle shell readiness when cancellation fences work before shell startup; preserve bounded existing-tool result finalization and truncation during destructive cleanup while rejecting new work and late callbacks.
- Add an invocation-scoped custom-tool process capability using the existing governor, captured runtime ownership, canonical workspace checks, pause-aware deadlines and bounded process-group cleanup. Bot tool migration and persistent-daemon integration remain release gates.
- Add a native runtime-control adapter with exact owned targets, serialized pause/resume requests, acknowledgment validation and fail-closed transport uncertainty.
- Hold queue/poll budgets, temporary-session completion and Telegram mutations through pause; preserve draft leases and recheck pause/fencing at actual admission boundaries.
- Exclude paused time from liveness/retry decisions, suppress destructive stuck decisions while held, and propagate native observer failure to deadlines and checkpoints.
- Fix the service-memory regression test to compare working set with the same raw sample rather than two independently changing samples.

## v1.18.33-bot.13-pre.7

- Core-owned bounded result polling with immutable run identity, cancellation, finite deadlines/attempts and stale-result rejection; application task polling retains its captured run fence.
