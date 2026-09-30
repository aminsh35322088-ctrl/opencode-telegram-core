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
- Telegram Core version: `1.18.33-bot.13-pre.2`
- Native runtime version: `0.1.0`
- grammY: `1.46.0`
- Telegram Bot API conformance target: `10.3`
- Platform: Linux x64

The machine-readable upstream/release source of truth is `upstream/lock.json`. Materialization fails closed if the configured tag does not resolve to the exact locked commit.

## Telegram-native runtime

The native runtime is under `runtime/`. Its main contracts include:

- exact `bindingGeneration + runId + workerGeneration` fencing,
- durable atomic binding persistence and crash-safe delete tombstones,
- one mutable execution boundary per Telegram binding/topic,
- per-binding OpenCode prompt workers and serialized queues,
- bounded deadlines, cancellation, provider retry ceilings, liveness and stuck-loop detection,
- rolling bounded subagent fan-out with per-parent/global admission caps, child-local deadlines, and sibling failure isolation,
- optional Telegram process-budget admission for shell/MCP/LSP/PTY/utility/helper children, enforced against cgroup memory headroom and global/category concurrency ceilings,
- session-scoped durable SSE replay/reconnect with cross-session fail-closed validation,
- Core-owned event routing through exact root bindings and verified session ancestry, with binding/run checks after asynchronous lookups,
- native Telegram Rich Message / Rich Markdown streaming through grammY,
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

The production runtime is now a Telegram-headless OpenCode server build. It preserves the complete server/session/provider/tool/MCP/skill/file API graph used by Telegram agents while excluding TUI, embedded Web UI, desktop and unrelated interactive CLI commands from the production binary. The full upstream CLI can still be built on demand with `./scripts/build-compat-cli.sh` as a migration/debug fallback; it is not part of the production release.

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

The compatibility suite starts the compiled runtime on loopback with isolated temporary state and no provider credentials. It verifies session lifecycle, context shape, idle interruption, exclusive durable-history cursors, session-stream isolation, reconnect semantics, concurrent SSE progress, and cleanup.

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
