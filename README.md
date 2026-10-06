# OpenCode Telegram Core

A Telegram-native, version-pinned runtime distribution derived from OpenCode.

> This project is independent and is not affiliated with or maintained by the OpenCode team.

## Purpose

`opencode-telegram-core` is the execution/runtime layer for Telegram-native OpenCode agents. It combines three versioned pieces that are tested and released as one compatibility unit:

- a pinned standalone OpenCode runtime,
- the matching generated OpenCode SDK,
- `@opencode-telegram/native-runtime`, which owns Telegram routing, isolation, lifecycle, streaming, scheduling, and Railway resource policy.

Telegram product UX and application-specific policy remain in `opencode-telegram-bot`; correctness-critical routing and execution invariants live here.

## Locked baseline

- Upstream: `anomalyco/opencode`
- Release: `v1.18.33`
- Commit: `51ef4be1d3c122f18fefb510dca8d778571f4f18`
- Bun: `1.3.14`
- Telegram Core candidate: `1.18.33-bot.13-pre.13`
- Native runtime version: `0.1.0`
- grammY: `1.46.0`
- Telegram Bot API conformance target: `10.3`
- Platform: Linux x64

The machine-readable upstream/release source of truth is `upstream/lock.json`. Materialization fails closed if the configured tag does not resolve to the exact locked commit.

## Telegram-native runtime

The current [minimum Telegram release scope and blockers](docs/MINIMUM_TELEGRAM_RELEASE.md) supersede older upstream-parity and migration gates. This candidate changes Core only; Bot migration is excluded. Stable publication requires ownership of the remaining production process classes and a healthy RC soak. See [owned result polling](docs/RESULT_POLLING.md).

The pre.8 prerelease contains [live runtime pause/resume](docs/PAUSE_RESUME.md), with existing runner preservation, phase fencing, background ownership, fail-closed recovery, and a native acknowledgment adapter that holds tasks and Telegram delivery. Core publisher provenance preserves original root/producer identity through live events; `SessionEventRouter.resolveExecution` requires that metadata and returns a complete run fence for execution delivery. A [governed custom-tool process capability](docs/CUSTOM_TOOL_PROCESSES.md) has passed Linux process-group regressions. The aligned runtime/SDK/native artifacts were verified and published from `f110bd25419b6bedc40db36e9ae929bc4e52b9ac`; the headless runtime is 124,340,352 bytes within its 140,000,000-byte budget. That historical release used the broader scope. Current Bot pause is abort plus continuation; live execution/pause/resume APIs remain production-supported for the target native-control migration. The current report defines the remaining production ownership gates without requiring Bot migration.

The native runtime is under `runtime/`. Its main contracts include:

- exact `bindingGeneration + runId + workerGeneration` fencing,
- durable atomic binding persistence and crash-safe delete tombstones,
- one mutable execution boundary per Telegram binding/topic,
- per-binding OpenCode prompt workers and serialized queues,
- Core-owned application tasks with exact run leases, workspace-bound temporary abort targets, and bounded remote cleanup,
- bounded deadlines, cancellation, provider retry ceilings, liveness and stuck-loop detection,
- rolling bounded subagent fan-out with per-parent/global admission caps, child-local deadlines, and sibling failure isolation,
- production process-budget admission for shell/MCP/LSP/utility/helper children (PTY admission is compatibility-only), enforced against cgroup memory headroom and global/category concurrency ceilings,
- directory-scoped SSE with original execution provenance and cross-session fail-closed validation; durable v2 replay remains compatibility-only,
- Core-owned event routing through exact root bindings and verified session ancestry, with binding/run checks after asynchronous lookups,
- native Telegram Rich Message / Rich Markdown streaming through grammY,
- GFM + Telegram Rich Markdown/HTML → semantic `AgentDocument` parsing with native headings, tables, ordered/task lists, fenced/preformatted code language hints, inline math/LaTeX, spoilers, mark/underline/sub/superscript, footnotes/references, anchors, expandable quotes, pull quotes, details, media/figure captions, collage/slideshow, maps, custom emoji/time entities, and trusted rich buttons,
- fail-closed handling for model-authored interactive content: `tg://user` links, callback/WebApp/login/copy/switch-inline buttons, and `tg://photo|video|audio|document?id=` aliases activate only through explicit trusted parser options/mappings,
- limit-aware Rich Message normalization/chunking (32,768 text characters, 500 blocks, 16 nesting levels, 50 media, 20 table columns) with grapheme-safe splitting, credit/caption accounting, colspan clamping, map geometry normalization, and unsafe-link sanitization,
- structured Rich Blocks for persisted final responses while partial streaming stays on Telegram-native Rich Markdown drafts,
- Persian/RTL-aware BiDi rendering: automatic RTL detection, Unicode directional isolation for mixed Persian/English technical runs, RTL-aware table alignment, streamed-draft `is_rtl` detection, and byte-preserving code blocks,
- Telegram Stop mapped to the exact draft/run,
- IPC spoof protection and workspace symlink-escape protection,
- durable scheduled-task admission/idempotency,
- Railway memory/restart budgets with idle-worker eviction,
- injectable admission policy so General/control-only behavior is a bot policy rather than a hidden Core fallback.

Supported Telegram routing domains include normal chats, forum topics, direct-messages topics, business connections, inline queries, and guest queries.

Subagent execution defaults to 4 active children per parent session and 6 globally, with at most 24 active/queued children per parent and a 20-minute active-execution deadline. These fail-safe limits can be tuned with `OPENCODE_TELEGRAM_SUBAGENT_CONCURRENCY`, `OPENCODE_TELEGRAM_SUBAGENT_GLOBAL_CONCURRENCY`, `OPENCODE_TELEGRAM_SUBAGENT_MAX_PENDING`, and `OPENCODE_TELEGRAM_SUBAGENT_TIMEOUT_MS`. Queue wait time does not consume the child execution deadline.

## Build

Run from the repository root on a trusted Linux x64 build host:

```bash
./scripts/build-runtime.sh
./scripts/build-sdk.sh
./scripts/build-native-runtime.sh
```

The scripts enforce the locked Bun version, materialize the exact upstream tag/commit, verify every downstream patch before applying any patch, install dependencies from locked inputs, and build the OpenCode and Telegram-native artifacts.

The production runtime is now a Telegram-headless OpenCode server build. It ships the audited Bot SDK routes and their internal agent dependencies. Production excludes PTY, v2/control-plane APIs, HTTP file/find/provider-auth routes, TUI, UI, sharing, self-upgrade, mDNS, Code Mode and the native FFF alternative search backend. Model execution, file tools, skills/plugins, MCP OAuth callbacks, LSP, subagents, abort and internal execution fencing remain; live HTTP execution/pause/resume support the target True Pause/Resume migration. File search uses the existing ripgrep backend. See the [consumer audit](docs/superpowers/specs/2026-10-02-minimum-telegram-core.md) and [release scope](docs/MINIMUM_TELEGRAM_RELEASE.md). The full upstream CLI can still be built on demand with `./scripts/build-compat-cli.sh` as a migration/debug fallback; it is not part of the production release.

A hard 140,000,000-byte size budget is enforced during production builds so accidental reintroduction of frontend dependency graphs fails the release. The current v1.18.33 headless build is about 124 MB, roughly one third smaller than the previous full-CLI production binary.

Generated outputs include:

- `dist/runtime/opencode` (Telegram-headless production server)
- `dist/build-info.json`
- `dist/sdk/`
- `dist/sdk/UPSTREAM_REVISION`
- `dist/native-runtime/index.js`
- `dist/native-runtime/runtime-info.json`

Inspect the compiled identity with:

```bash
./dist/runtime/opencode --version
./dist/runtime/opencode debug build-info | python3 -m json.tool
cat dist/sdk/UPSTREAM_REVISION
cat dist/native-runtime/runtime-info.json
```

For this baseline, `--version` must be exactly `1.18.33`; runtime, SDK, and native-runtime metadata must agree with the locked release identity.

The SDK build also validates `runtime/compat/opencode-telegram-bot-sdk-surface.json`, a contract generated from the OpenCode client members currently used by `opencode-telegram-bot`. The release fails if any required session, MCP, permission, question, provider/config, project, skill/agent, event, path, command, or health API disappears.

## Verification

Run all lightweight repository/runtime tests:

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
./scripts/test-native-runtime.sh
bash -n scripts/*.sh
python3 -m py_compile tests/*.py tests/compatibility/*.py
git diff --check
```

Run the compiled OpenCode compatibility suite:

```bash
./scripts/run-compatibility.sh
```

The production suite starts the actual compiled runtime with isolated state and a deterministic local model fixture. It verifies required/forbidden APIs, real model and shell execution, physical pause/resume, abort while stopped, stale ownership, history and cleanup. Historical v2 durable-history/SSE checks run separately against the optional full compatibility CLI. Unsupported production APIs fail with non-success responses.

## Railway smoke verification

`Dockerfile.railway-smoke` builds the native runtime in Railway, executes the strict typecheck and full Bun test suite during image construction, then serves `/health`.

A healthy deployment logs `core_smoke_ready` and returns Telegram conformance metadata from `/health`. The smoke service requires no bot token or provider credential.

## Release packaging

After runtime, SDK, native runtime, and compatibility verification succeed:

```bash
./scripts/package-release.sh
./scripts/verify-release.sh
```

The release directory contains:

- `opencode-telegram-core-linux-x64.tar.gz`
- `opencode-telegram-core-sdk.tar.gz`
- `opencode-telegram-core-sdk-node.tar.gz` (npm-installable Node package)
- `opencode-telegram-native-runtime.tar.gz`
- `opencode-telegram-native-runtime-node.tar.gz` (Node 22+ ESM package with declarations)
- `build-info.json`
- `release-manifest.json`
- `SHA256SUMS`

Packaging is fail-closed: the embedded Telegram Core commit must match repository `HEAD`; upstream, runtime, SDK, and native-runtime identities must match; checksums must verify; and verification re-runs the extracted runtime before accepting the release.

## Upgrade procedure

1. Review the new OpenCode release, session/event contract changes, Telegram Bot API changes, grammY changes, and build-system changes.
2. Update `upstream/lock.json` with the exact upstream tag/commit, version, Bun version, and next Telegram Core version.
3. Resolve patch drift explicitly; never force-apply a patch.
4. Add a reproduced failing regression test before changing correctness-critical Core behavior.
5. Run the repository/runtime tests, then rebuild OpenCode runtime, SDK, and native runtime from clean state.
6. Run compatibility, Railway smoke, package verification, static checks, and a whole-branch diff review.
7. Update `opencode-telegram-bot` only after the new Core release is verified.

## Bot pinning model

`opencode-telegram-bot` should consume an immutable Telegram Core release, not `main` and not an unversioned latest artifact.

OpenCode runtime, generated SDK, and Telegram-native runtime form one compatibility unit. A bot deployment should pin the Telegram Core version and verified artifact checksum and retain the previous known-good release for rollback.

## Downstream OpenCode patch scope

The downstream OpenCode patch remains deliberately small. It currently adds machine-readable build identity:

```bash
opencode debug build-info
```

Provider behavior and OpenCode session semantics remain upstream-owned. The Telegram-native runtime composes those public contracts instead of forking their implementation.

## Licensing and design

The upstream OpenCode MIT license is retained at `LICENSES/upstream-opencode-MIT.txt`.

- Telegram-native runtime foundation: `docs/superpowers/specs/2026-09-27-telegram-native-runtime-foundation.md`

The native v2 session client/event pump are retained in `runtime/src/compat.ts` for migration/debug testing and excluded from production native artifacts. Production builds use a checked-in models.dev snapshot to pin the model-catalog input. Container deployments require a child-reaping init (the actual-runtime Railway validation image uses tini); uncertain group cleanup never releases admission.
