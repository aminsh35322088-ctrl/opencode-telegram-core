# OpenCode Telegram Core

A Telegram-oriented, version-pinned runtime distribution derived from OpenCode.

> This project is independent and is not affiliated with or maintained by the OpenCode team.

## Purpose

`opencode-telegram-core` builds the OpenCode runtime used by `opencode-telegram-bot` without vendoring the full upstream source into this repository.

The exact upstream revision is materialized on demand, a deliberately small patch series is applied, and the standalone runtime plus matching SDK are built and verified together. Telegram UI and bot business logic stay outside this repository.

## Locked baseline

- Upstream: `anomalyco/opencode`
- Release: `v1.18.31`
- Commit: `014614d35b397775e5d397a490fc72368c894ec2`
- Bun: `1.3.14`
- Telegram Core version: `1.18.31-bot.1`
- Initial platform: Linux x64

The machine-readable source of truth is `upstream/lock.json`. Materialization fails closed if the configured tag does not resolve to the exact locked commit.
## Build

Run from the repository root on a trusted Linux x64 build host:

```bash
./scripts/build-runtime.sh
./scripts/build-sdk.sh
```

The scripts enforce the locked Bun version, materialize the exact upstream tag/commit, verify every patch before applying any patch, install dependencies with the frozen upstream lockfile, and use the official OpenCode standalone build path.

Generated outputs:

- `dist/runtime/opencode`
- `dist/build-info.json`
- `dist/sdk/`
- `dist/sdk/UPSTREAM_REVISION`

Inspect the compiled identity with:

```bash
./dist/runtime/opencode --version
./dist/runtime/opencode debug build-info | python3 -m json.tool
cat dist/sdk/UPSTREAM_REVISION
```

For this baseline, `--version` must be exactly `1.18.31`; runtime and SDK identity must both reference the locked upstream commit.
## Compatibility verification

The compatibility suite starts the compiled runtime on loopback with isolated temporary state and requires no model/provider credentials:

```bash
./scripts/run-compatibility.sh
```

It verifies session lifecycle, context shape, idle interruption, exclusive durable-history cursors, per-session event isolation, reconnect semantics, concurrent session SSE progress, and server cleanup.

The provider-free event trigger uses `POST /api/session/{sessionID}/prompt` with `resume: false`, which commits a durable Session event without starting model execution.

## Repository tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
bash -n scripts/*.sh
python3 -m py_compile tests/*.py tests/compatibility/*.py
git diff --check
```

Heavy clean builds should run only while GitHub Runner Lab reports `RUNTIME_STATE=SAFE`.
## Release packaging

After runtime, SDK, and compatibility verification succeed:

```bash
./scripts/package-release.sh
./scripts/verify-release.sh
```

The release directory contains:

- `opencode-telegram-core-linux-x64.tar.gz`
- `opencode-telegram-core-sdk.tar.gz`
- `build-info.json`
- `release-manifest.json`
- `SHA256SUMS`

Packaging is fail-closed: the embedded Telegram Core commit must match repository `HEAD`, the upstream/runtime/SDK identities must match `upstream/lock.json`, checksums must verify, and verification re-runs the extracted runtime before accepting the release.

## Upgrade procedure

1. Review the new upstream release, migration notes, session/event changes, and build-system changes.
2. Update `upstream/lock.json` with the new tag, exact commit, upstream version, required Bun version, and next Telegram Core version.
3. Materialize the new revision and resolve patch drift explicitly; never force-apply a patch.
4. Keep the downstream patch series as small as possible. Functional Core changes require a reproduced failing test first.
5. Run the full unit suite, then delete generated `.work/` and `dist/` state and rebuild runtime plus SDK from clean state.
6. Run compatibility, package, verify, static checks, and whole-branch review before publishing.
7. Update `opencode-telegram-bot` only after the new Core release is verified.
## Bot pinning model

`opencode-telegram-bot` should consume an immutable Telegram Core release, not `main` and not an unversioned latest artifact.

Runtime and SDK are one compatibility unit: both must originate from the same locked OpenCode commit. A bot deployment should pin the Telegram Core version and verified artifact checksum and retain the previous known-good release for rollback.

Core Phase 1 deliberately does not modify the bot. Bot migration and any simplification of the bot's existing event bridge are separate reviewed changes after a Core release is verified.

## Phase 1 downstream patch scope

The initial patch series only adds machine-readable build identity via:

```bash
opencode debug build-info
```

It does not modify provider behavior, session execution, event ordering, Telegram UI, topic routing, or bot business logic. Native OpenCode v2 session isolation/reconnect behavior is verified rather than reimplemented downstream.

## Licensing and design

The upstream OpenCode MIT license is retained at `LICENSES/upstream-opencode-MIT.txt`.

- Architecture: `docs/superpowers/specs/2026-09-20-opencode-telegram-core-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-09-20-opencode-telegram-core-phase1.md`
