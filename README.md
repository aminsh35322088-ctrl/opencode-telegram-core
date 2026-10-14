# OpenCode Telegram Core

OpenCode Telegram Core is the versioned execution layer used by OpenCode Telegram Bot. It packages a pinned OpenCode server runtime, the SDK generated from that same source revision, and the Telegram-native runtime that owns session routing, Topic isolation, execution lifecycle, streaming, rendering, scheduling, and resource admission.

This repository is an independent downstream distribution derived from OpenCode. It is not affiliated with or maintained by the OpenCode team.

## Purpose and system boundary

The Core exists so multiple Telegram contexts can safely share the same proven runtime contracts without duplicating session ownership, event routing, cleanup, or Telegram-specific execution behavior in the Bot.

| This repository owns | The Bot owns |
|---|---|
| Exact OpenCode source/runtime and generated SDK compatibility | Telegram product UI, commands, settings, translations, and user workflows |
| Per-binding worker queues, execution/run identity, cancellation, liveness, and lifecycle fencing | Which product action to offer and how to explain its outcome |
| Durable Telegram binding registry and Worker-facing runtime contracts | Telegram polling, actor authorization, Railway infrastructure credentials, and project/Worker allocation |
| Telegram message parsing/rendering/stream transport and API limits | Model/provider UX, integrations, persistent product settings, and application policy |
| Runtime process/resource admission and safe Worker boundaries | Control Plane request orchestration and user-specific business rules |

The Bot must pin an immutable Core release. Do not consume Core main or independently upgrade the OpenCode runtime, SDK, or native package: they are released and verified as one compatibility unit.

## Current locked baseline

The source of truth is upstream/lock.json. The Bot release pin is core-release.lock.json in the Bot repository.

| Input | Locked value |
|---|---|
| Upstream repository | anomalyco/opencode |
| OpenCode version | 1.18.33 |
| OpenCode commit | 51ef4be1d3c122f18fefb510dca8d778571f4f18 |
| Bun | 1.3.14 |
| Telegram Core candidate | 1.18.33-bot.13-pre.35 |
| Native runtime package | 0.1.0 |
| Platform | Linux x64 |
| Production runtime size ceiling | 120,000,000 bytes |

Materialization verifies that the configured upstream tag resolves to the exact locked commit. Patch application and release packaging fail closed on source, identity, or checksum mismatch.

## Architecture

~~~text
Bot Control Plane
      │ signed node requests and scoped execution
      ▼
Topic Worker agent (worker/)
      │ private loopback API / process boundary
      ├── OpenCode Telegram-headless server (dist/runtime/opencode)
      └── Telegram-native runtime (runtime/src)
          bindings · queues · routing · streams · rendering · budgets
~~~

The production runtime is Telegram-headless. It retains the server and SDK surface needed by the Bot and removes unrelated UI, TUI, sharing, mDNS, self-upgrade, PTY, and other unsupported production surfaces. Unsupported routes/configuration fail rather than silently exposing partial behavior. The full compatibility CLI is a local migration/debug artifact and is not the production release.

## Repository map

| Path | Purpose |
|---|---|
| upstream/lock.json | Immutable upstream version, source commit, Bun version, and Core candidate identity |
| patches/ | Small downstream patches against the locked OpenCode source |
| runtime/src/opencode | Topic worker, session and execution clients, event pump/router, provenance, and temporary sessions |
| runtime/src/runtime | Binding registry/store, run identity, signed envelopes, serial queues, deadlines, liveness, outbound gateway, and workspace guards |
| runtime/src/ipc | Bounded worker communication and outbound gates |
| runtime/src/telegram | Telegram route context, grammY transport, API budgets, and rich streaming adapters |
| runtime/src/presentation | Markdown/HTML parsing, semantic documents, Rich Message rendering, chunking, and Persian/RTL layout |
| runtime/src/scheduler | Owned task dispatch and scheduling primitives |
| runtime/src/railway | Runtime resource-governor policy using Railway/cgroup observations |
| worker/ | Topic Worker agent: identity bootstrap, authenticated RPC, credential mediation, generated-action bridge, and constrained helper proxies |
| scripts/ | Reproducible upstream materialization, patching, builds, audits, tests, and release verification |
| tests/ | Unit, integration, compiled-runtime, compatibility, and lifecycle tests |
| validation/ | Deployment/runtime evidence fixtures and validation tools |
| docs/ | Ownership contracts, release scope, migration decisions, and operational evidence |

## Runtime behavior and invariants

### Binding and execution ownership

- A Telegram binding has an exact chat/thread identity and binding generation. A Worker identity/generation and run ID fence each execution.
- Mutating prompts are serialized per binding so two updates cannot concurrently change the same Topic's execution state.
- Event delivery verifies session ancestry, binding, and run provenance before emitting output. Delayed events from replaced/deleted generations are rejected.
- The durable binding store writes updates atomically. Delete tombstones and generation changes prevent restart/retry from reviving stale ownership.
- Queue deadlines, request deadlines, provider retry ceilings, stuck-run detection, and cancellation are explicit and bounded.

### Worker and workspace lifecycle

A Worker slot serves one Topic at a time. Retirement joins Core work, owned processes, callbacks, and active streams; sanitizes Topic/session/workspace state; and advances identity/signing generation. Only a clean, proven state becomes available for reuse. Uncertain cleanup retains the slot or retires the container; it is never reported ready by assumption.

The Worker has a constrained public surface: readiness and authenticated RPC. The OpenCode API is loopback-only. Signed requests bind node, generation, Telegram chat/thread, session, operation, timestamp, and nonce; replay admission is durable. See worker/README.md for the protocol and credential boundaries.

### Process and resource governance

Native runtime admission accounts for cgroup memory headroom, active process categories, concurrency, reserved memory, and lifecycle. Required shell, MCP, LSP, utility, and helper processes use governed ownership/retirement paths. A rejected admission is not retried through an unbudgeted path. Core resource ceilings inform Worker capacity, while the Bot decides user-facing pool policy and Railway provisioning.

### Telegram output and rich content

The runtime parses supported Markdown/GFM and Telegram rich content into a semantic document, normalizes it against Telegram limits, and streams through grammY. Final responses can use structured rich blocks; drafts use bounded stream updates. Rendering handles safe links, chunking, captions, tables, code language labels, Persian/RTL text direction, and mixed-script technical text while keeping code bytes intact.

Model-authored interactive links/buttons are fail-closed unless the trusted application explicitly maps and enables them. This prevents generated text from silently becoming an untrusted Telegram action.

### Scheduling and result observation

Owned task dispatch uses durable admission/idempotency and exact run leases. Result polling is observational: it may read bounded output for an owned run but does not start model/tool execution or become the session/process owner. See docs/RESULT_POLLING.md.

## Behavioral contracts for AI contributors

Core changes affect every Bot that pins this release. Treat these as runtime compatibility and safety contracts. The Bot decides product policy and wording; Core enforces exact execution ownership and transport behavior.

| Area | Required behavior | Failure behavior | Regression coverage |
|---|---|---|---|
| Main chat vs. Topic execution | Core accepts execution only through a bound, admitted Topic/session. Main-chat navigation and Control Plane operations do not imply a model execution context. | Missing or control-only binding is rejected by application admission; Core must not invent a session, workspace, or Worker. | runtime/test/topic-worker.test.ts; runtime/test/production-surface.test.ts; docs/BOT_CORE_CALLS.md |
| Binding identity | Resolve the exact Telegram chat/thread binding, binding generation, Worker generation, session, and run before any mutation or event delivery. A callback that resumes after an async lookup must re-check the fence. | Reject stale/foreign/missing identity. Never guess, redirect to another Topic, or accept a prior generation. | runtime/test/binding-store.test.ts; runtime/test/session-event-router.test.ts; runtime/test/topic-worker.test.ts |
| Prompt admission and queue | Serialize mutating prompts for one binding and preserve independent progress for other bindings. Keep deadlines, cancellation, queue admission, and retry limits bounded. | Reject expired or over-capacity work explicitly. Cancellation must settle callers even when a dependency ignores its abort signal. Do not launch duplicate execution on retry. | runtime/test/core.test.ts; runtime/test/deadline.test.ts; runtime/test/liveness.test.ts |
| Worker state and readiness | One slot owns at most one Topic. ready-unbound means the agent can accept one binding; authenticated Core ready means session execution can be admitted. /health is agent liveness only. | Never infer model/session readiness from process liveness. Do not mark a Worker reusable until old ownership is completely retired and the next generation is installed. | runtime/test/topic-worker.test.ts; runtime/test/telegram-railway.test.ts; worker/README.md |
| Retirement and workspace cleanup | Stop or join active Core work, owned child processes, callbacks, and streams before sanitizing or reusing a workspace. Preserve admission while cleanup is uncertain. | Timeout, EOF, launcher exit, or lost container authority is not proof of an empty process tree. Retain/fence ownership or retire the container; never report a clean slot by assumption. | runtime/test/process-boundary.test.ts; tests/diagnostics/linux-process-scope/README.md; docs/PROCESS_OWNERSHIP_MATRIX.md |
| Execution controls | Core's pause/resume/cancellation are INTERNAL runtime primitives: they apply only to the existing admitted run and exact temporary target, with strict operation ordering and acknowledgment semantics. An internal pause must not create a new run. Ambiguous control is not success. They are not user commands — the Bot's Telegram interface exposes no pause/resume/abort control, and the only user-facing execution control is Telegram's native Stop. | Hold output when state is uncertain and require explicit reconciliation/cleanup; do not turn a failed internal pause into an implicit cancellation or restart. | runtime/test/native-execution-control.test.ts; runtime/test/session-execution-control.test.ts; docs/TELEGRAM_EXECUTION_CONTROL.md |
| Event provenance and delivery | Accept events only when origin, session ancestry, binding, and run fence match. Stream only for a prepared active run, with readiness acknowledged before prompt delivery. | Drop stale, foreign, malformed, or unproven events. Never leak output between sessions or send a success response for a stream that never became ready. | runtime/test/session-event-router.test.ts; runtime/test/rich-stream.test.ts; runtime/test/execution-observation.test.ts |
| Process/resource admission | Govern required shell, MCP, LSP, utility, and helper children using the current cgroup-aware budget and lifecycle owner. Preserve category/concurrency ceilings and confirmed retirement. | Admission denial remains denial. Do not retry via direct spawn, lower the ceiling silently, or release budget while a child may still be alive. | runtime/test/process-boundary.test.ts; docs/PROCESS_OWNERSHIP_MATRIX.md; docs/MINIMUM_TELEGRAM_RELEASE.md |
| Worker RPC and credentials | Authenticate the exact signed envelope, enforce nonce/replay and generation checks, and lease only the requested credential capability for its bounded operation. Keep raw OpenCode API private. | Fail closed on invalid signature, stale generation, replay, unsupported transport, or missing lease. Never expose secret values in Core config, environment, prompts, or logs. | worker/README.md; tests/test_worker.py; docs/MCP_OAUTH_OWNERSHIP.md; docs/PROVIDER_AUTH_OWNERSHIP.md |
| Rich text and Telegram delivery | Normalize rich content to Telegram limits, chunk without corrupting graphemes/entities/code, sanitize unsafe links, and preserve mixed RTL/LTR readability. Keep untrusted model-authored buttons/links inert unless explicitly mapped by trusted application policy. | Prefer a safe text/rendering fallback to dropping the assistant response. Do not bypass limits by emitting an invalid request or silently activate a generated action. | runtime/test/telegram-message-renderer.test.ts; runtime/test/markdown-document-renderer.test.ts; runtime/test/rich-blocks.test.ts; runtime/test/persian-bidi.test.ts |
| Scheduler and result polling | Admit durable tasks idempotently and bind execution/results to the owning task/run. Polling observes an existing owned run only. | Duplicate dispatch must not create duplicate execution. A late poll result cannot replace output for a newer run or become an execution owner. | runtime/test/ipc-scheduler.test.ts; runtime/test/owned-topic-task.test.ts; runtime/test/result-poller.test.ts |
| Release artifacts | Runtime, SDK, and native package must come from the exact locked source and advertise matching identity. Bot consumes only an immutable verified release. | Reject mismatched source, version, checksum, SDK surface, or package identity. A successful build/health endpoint alone is not stable-release evidence. | scripts/verify-release.sh; scripts/verify-bot-sdk-surface.ts; docs/MINIMUM_TELEGRAM_RELEASE.md |

### How another AI should change Core

1. Read the locked baseline, this README, and the relevant ownership/release document. Inspect the Bot consumer call sites before changing an API contract.
2. State the user-visible requirement and identify whether the behavior belongs to Bot policy, Core execution, or the Worker trust boundary. Do not move a product decision into Core just because it is convenient.
3. Trace the full lifecycle: admission → owner identity → execution/transport → cancellation or completion → cleanup → durable state/generation. Include restart, timeout, duplicate, stale-generation, and uncertain-cleanup cases.
4. Reproduce the failure with a focused test before implementing the fix. Tests must assert externally observable results and ownership/cleanup, not only mirror helper internals.
5. Preserve fail-closed behavior. Never turn “unknown” into “healthy,” “empty,” “authorized,” or “completed.” Keep the original error category actionable for the Bot.
6. Run the smallest relevant native/Worker/compiled regression first, then the repository's full verification and exact-candidate package checks required by the release scope.
7. Update this contract or linked design document when intended behavior changes, and keep implementation, test, SDK surface, and release identity aligned.

The user's explicit requirement defines the requested product outcome. This README defines cross-Bot runtime invariants. When a request appears to conflict with an invariant, explain the exact conflict and obtain the user's decision before weakening isolation, authorization, cleanup, or resource safety.

### Current release status

This is a prerelease candidate, not a stable release. The current production scope and verified blockers are maintained in docs/MINIMUM_TELEGRAM_RELEASE.md. That report distinguishes implemented runtime contracts from the remaining ownership, hard-crash, long-soak, and rollback evidence needed for stronger release claims. Do not infer stable readiness from a successful build or a healthy smoke service.

## Build from source

Builds target a trusted Linux x64 host and the locked Bun toolchain. Start from a clean checkout:

~~~bash
./scripts/build-runtime.sh
./scripts/build-sdk.sh
./scripts/build-native-runtime.sh
~~~

The scripts materialize the exact upstream tag/commit, verify downstream patches, install from locked inputs, build the Telegram-headless server, generate the matching SDK, type-check/test the native runtime, and write release identity metadata.

The production runtime build enforces the 120,000,000-byte ceiling and audits the production dependency graph. Generated artifacts include:

- dist/runtime/opencode — Telegram-headless server
- dist/build-info.json — upstream/Core build identity
- dist/sdk/ and dist/sdk/UPSTREAM_REVISION — generated SDK and source revision
- dist/native-runtime/index.js and runtime-info.json — native package and identity

To inspect a build:

~~~bash
./dist/runtime/opencode --version
./dist/runtime/opencode debug build-info
cat dist/sdk/UPSTREAM_REVISION
cat dist/native-runtime/runtime-info.json
~~~

All runtime, SDK, and native-runtime identities must agree with upstream/lock.json and the repository commit.

## Test and verify

Run the lightweight checks from the repository root:

~~~bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
./scripts/test-native-runtime.sh
bash -n scripts/*.sh
python3 -m py_compile tests/*.py tests/compatibility/*.py
git diff --check
~~~

The compiled production compatibility suite is:

~~~bash
./scripts/run-compatibility.sh
~~~

It starts the compiled server with isolated state and a deterministic local model fixture and checks the retained API surface, real model/shell execution, session history, streaming/provenance, cancellation, cleanup, and lifecycle fencing. The full compatibility CLI is used only for the separate migration/debug surface.

Railway smoke image verification is separate from full runtime verification. A smoke deployment proves its defined build/health contract; it does not prove long-run resource stability, complete crash containment, or stable-release readiness. See docs/MINIMUM_TELEGRAM_RELEASE.md.

## Package and release

After source, runtime, SDK, native-runtime, and compatibility verification pass:

~~~bash
./scripts/package-release.sh
./scripts/verify-release.sh
~~~

The release packages the Linux x64 runtime, SDK variants, native-runtime variants, build identity, release manifest, and SHA256SUMS. Packaging rejects mismatched source identities or invalid checksums. The consuming Bot should update its Core lock only after validating an immutable Core release and its artifacts.

## Upgrade procedure

1. Review upstream session/event API changes, Telegram Bot API changes, grammY changes, and build-system changes.
2. Change upstream/lock.json to the exact new tag and commit and the next Core candidate identity.
3. Resolve patch drift deliberately; never force-apply an unverified patch.
4. Add a reproduced regression test for any changed ownership/routing behavior.
5. Build the runtime, SDK, and native runtime from clean inputs; run native, upstream, compatibility, package, and release checks.
6. Validate the exact candidate artifact in the Railway smoke/compiled-runtime environment and preserve its identity/checksum evidence.
7. Update the Bot's Core pin only after the Core artifact set is verified.

## Design and operational references

- Current release scope and gates: docs/MINIMUM_TELEGRAM_RELEASE.md
- Bot/Core API ownership: docs/BOT_CORE_CALLS.md
- Worker process/runtime parity: docs/WORKER_RUNTIME_PARITY.md
- Process ownership matrix: docs/PROCESS_OWNERSHIP_MATRIX.md
- Railway containment boundary: docs/RAILWAY_CONTAINMENT_BOUNDARY.md
- Telegram execution control: docs/TELEGRAM_EXECUTION_CONTROL.md
- Result polling: docs/RESULT_POLLING.md
- Worker credential and transport boundary: worker/README.md

The diagnostic guides explain how to interpret the experiments:

- tests/diagnostics/custom-process-tree/README.md — escaped custom-process ownership
- tests/diagnostics/linux-crash-supervisor/README.md — unshipped crash supervisor
- tests/diagnostics/linux-process-scope/README.md — Linux process-scope probes
- tests/diagnostics/railway-boundary/README.md — disposable Railway boundary probe

These are experiments, not production code or passing release gates unless the current release report explicitly says so.
