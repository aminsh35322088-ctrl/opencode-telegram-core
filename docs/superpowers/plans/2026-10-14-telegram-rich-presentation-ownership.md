# Telegram Rich Presentation Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development task-by-task. Checkboxes represent verified evidence, not intent.

**Goal:** Make Core the single source of truth for Telegram-rich presentation primitives, move compact Markdown-table policy out of Bot, and expose a tested capability contract.

**Architecture:** Keep parsing/rendering semantics in `@opencode-telegram/native-runtime`; Bot remains a consumer. Existing rich primitives stay behavior-compatible; the only semantic presentation change is GFM Markdown tables becoming compact by default.

**Spec:** `docs/superpowers/specs/2026-10-14-telegram-rich-presentation-ownership.md`

**Bot integration:** `aminsh35322088-ctrl/opencode-telegram-bot#191`

## Global constraints

- Do not move Bot lifecycle/activity aggregation into Core.
- Existing Details/math/date-time/anchors/references/expandable quotes/buttons/fallback/RTL behavior remains compatible.
- GFM Markdown tables set `isCompact: true`; explicit HTML table compactness remains attribute-driven.
- Capability descriptor only claims tested behavior.
- No arbitrary text-color API.
- No privileged model-generated interactive action is enabled.
- No merge/release is part of this PR.

## Task 1 — Compact GFM tables

- [x] Add failing regression requiring GFM `isCompact: true` while preserving cells, headers and alignment.
- [x] Capture RED CI evidence: run `38593967940`, 342 pass / 1 expected fail.
- [x] Set `isCompact: true` in the GFM `tableBlock()` path.
- [x] Prove `<table>` stays explicit/non-compact unless `compact` is authored.
- [x] Verify Telegram renderer produces `is_compact: true` from the semantic property.

## Task 2 — Public rich-presentation capability contract

- [x] Add failing import/contract test.
- [x] Capture RED typecheck evidence: run `38594262691` failed because export was absent.
- [x] Add `runtime/src/presentation/telegram-rich-capabilities.ts`.
- [x] Export `TELEGRAM_RICH_PRESENTATION_CAPABILITIES` from public runtime index.
- [x] Bind the contract to public parser/renderer smoke coverage for Details, expandable quote, math, date-time, anchors/references and compact tables.

## Task 3 — Full regression evidence

- [x] TypeScript typecheck — success.
- [x] Bun runtime — **344 / 344 pass**, 27 files, 1863 assertions.
- [x] unbound session probe boundary — **3 / 3 pass**.
- [x] Python repository suite — **326 / 326 pass**.
- [x] toolchain/release contracts — success.
- [x] `upstream-runtime` — success.
- [x] `telegram-headless` / production graph / Bot SDK surface — success.
- [x] Record TDD + CI evidence in the design spec / PR.

Verified synchronized feature head: `b33344c939fd646a54238199c052e6252aeae1fd`.

Full post-rebase CI: **run `38601561471`**:

- [x] `validate` — success.
- [x] `upstream-runtime` — success.
- [x] `telegram-headless` — success.

The feature head was rebased onto Core `main` `9e6e5e152520a2e1584d2edebe55057d27d42370`. Immediately after that successful CI, the soak process appended a documentation-only checkpoint `c794cba48783eda6df24f8a9c3115ff2f81b8bca` touching `docs/SOAK_CHECKPOINT.md`. It does not overlap this PR's runtime/test files and does not invalidate the feature evidence; mergeability/freshness must still be refreshed immediately before an eventual merge.

## Task 4 — Review gate

- [x] Synchronize feature work onto then-latest Core `main` without dropping PR changes.
- [x] Re-run all three GitHub Actions jobs on the synchronized feature head.
- [x] Require `validate`, `upstream-runtime`, and `telegram-headless` = success.
- [x] Verify the later soak checkpoint is documentation-only and does not overlap feature files.
- [x] Update PR documentation with synchronized head SHA and CI run ID.
- [x] Ready for independent code review; **not** merged or released.

## Task 5 — Bot handoff

- [x] Bot PR #191 documentation explicitly delegates semantic Telegram grammar to Core #31.
- [x] Bot #191 is prohibited from adding parallel Details/math/date/reference/table/button parsers.
- [x] Bot #191 removed its table post-process and added a version-agnostic pass-through regression, so Bot no longer owns table compactness semantics.
- [ ] After Core #31 is accepted, publish or otherwise provide a pinned native-runtime artifact containing #31.
- [ ] Update Bot #191 to that exact artifact and prove Core supplies GFM compactness directly.
- [ ] Re-run full Bot verification after that artifact migration before any production merge/deploy.

## Final review focus

- Markdown table compactness must not alter data, alignment or fallback text.
- Explicit HTML table semantics must stay author-controlled.
- Capability metadata must match the tested public runtime surface.
- Persian/RTL, rich fallback, limits and chunking must remain unchanged.
- Ownership must stay clean: Core semantic presentation; Bot run lifecycle/UI.