# Minimum Telegram Core Implementation Plan

Execute inline; no delegated agents. Spec: `docs/superpowers/specs/2026-10-02-minimum-telegram-core.md`.

Global constraints: Bot read-only; no migration; no upstream parity; keep required inference/tools/files/LSP/MCP/plugins/scheduling/renderer/subagents and all closed invariants; no release claim without cumulative verification.

Review focus: reference discovery must survive narrower composition; unsupported routes/config must fail; live SSE/cancellation must retain exact fences; compatibility builds must remain full; persistent browser support must not be falsely declared owned.

- [x] Record baseline compiled identity/size and bundle input contribution report.
- [x] Add red production composition/API regressions, preserving Bot SDK contract and compatibility checks.
- [x] Create production-only composition patch that removes unrelated routes/services and narrows reference location service construction; reuse upstream implementations.
- [x] Apply production patch only for headless build and its cumulative tests. Materialize a separate compatibility tree for full CLI.
- [x] Run focused production and previously closed process/cancel tests after each cut.
- [ ] Run typecheck, native tests, upstream Telegram/runtime suite, SDK surface, compatibility, shell cancellation repeats, renderer/RTL, polling, Topics, subagents, admission and release/checksum gates.
- [x] Build compiled candidate; collect actual before/after bytes, graph/dependency/process changes and RSS/startup/cleanup observations.
- [ ] Deploy compiled candidate to Core validation service on Railway without touching Bot; exercise production representative runtime and inspect logs/resource/restarts. Fix regressions and repeat cumulative gates.
- [x] Update process lifecycle audit and release-readiness report with defensible completion denominators and shortest remaining RC/stable paths.
