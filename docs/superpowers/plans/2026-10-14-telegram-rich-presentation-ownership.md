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
- No merge/release until branch is synchronized to latest `main` and fresh CI is green.

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

Final pre-sync implementation head: `635491ac6161f678142d322bd0308a488086a477`.

Final pre-sync CI: `38594717524`.

- [x] TypeScript typecheck — success.
- [x] Bun runtime — **344 / 344 pass**, 27 files, 1863 assertions.
- [x] unbound session probe boundary — **3 / 3 pass**.
- [x] Python repository suite — **326 / 326 pass**.
- [x] toolchain/release contracts — success.
- [x] `upstream-runtime` — success.
- [x] `telegram-headless` / production graph / Bot SDK surface — success.
- [x] Record TDD + CI evidence in the design spec.

## Task 4 — Branch freshness / review gate

Current latest observed Core `main`: `9ed7f4ec42701435d216497ddb3a7bfb709a800a`.

At the evidence checkpoint the PR branch is **8 commits ahead / 2 behind** latest main; the behind commits are outside the rich-presentation implementation, but stale green CI is not final merge evidence.

- [ ] Synchronize branch onto latest Core `main` without dropping PR changes.
- [ ] Re-run all three GitHub Actions jobs on the synchronized head.
- [ ] Require `validate`, `upstream-runtime`, and `telegram-headless` = success.
- [ ] Confirm PR `mergeable=true`.
- [ ] Update PR body/spec with synchronized head SHA and final CI run ID.
- [ ] Mark PR ready for independent review only after the items above.

## Task 5 — Bot handoff

- [x] Bot PR #191 documentation explicitly delegates semantic Telegram grammar to Core #31.
- [x] Bot #191 is prohibited from adding parallel Details/math/date/reference/table/button parsers.
- [ ] After Core #31 is accepted, publish or otherwise provide a pinned native-runtime artifact containing #31.
- [ ] Update Bot #191 to that exact artifact.
- [ ] Remove Bot's temporary `is_compact` table post-process only after the new artifact is pinned.
- [ ] Re-run full Bot CI after the artifact migration.

## Final review focus

- Markdown table compactness must not alter data, alignment or fallback text.
- Explicit HTML table semantics must stay author-controlled.
- Capability metadata must match the tested public runtime surface.
- Persian/RTL, rich fallback, limits and chunking must remain unchanged.
- Ownership must stay clean: Core semantic presentation; Bot run lifecycle/UI.
