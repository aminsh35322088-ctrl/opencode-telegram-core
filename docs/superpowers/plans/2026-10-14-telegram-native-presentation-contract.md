# Telegram-Native Presentation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Core/native-runtime the single authoritative, regression-tested owner of Telegram Rich Message presentation used by the bot.

**Architecture:** Do not duplicate capabilities already present on Core main. Harden existing `AgentDocument` parsing/rendering/chunking/fallback with focused regression tests and only patch production code when a test exposes a real gap. Bot-specific run presentation stays out of Core.

**Tech Stack:** TypeScript, Bun test, `grammy` Bot API types, native-runtime presentation pipeline.

**Spec:** `docs/superpowers/specs/2026-10-14-telegram-native-presentation-contract.md`

## Global Constraints

- Existing Core primitives are authoritative; no bot-derived duplicate parser.
- Preserve plain fallback for every Rich feature.
- `allowInteractiveButtons` remains required for model-authored interactive buttons.
- No custom text-color feature.
- No bot Activity/reasoning/menu code in Core.
- Every production code change requires a failing regression test first.

## Review Focus

- malformed/unclosed HTML/details must remain visible rather than disappear;
- nested details must respect chunk/block budgets;
- RTL/Persian inside details must keep the established bidi contract;
- unsafe links/button payloads must not become privileged actions;
- rich/native rendering and plain fallback must remain semantically equivalent enough to avoid content loss.

---

### Task 1: Prove the existing native capability matrix

**Files:**
- Modify/Test: `runtime/test/markdown-document-renderer.test.ts`
- Modify/Test: `runtime/test/rich-inline.test.ts`
- Modify/Test: `runtime/test/rich-blocks.test.ts`

**Produces:** regression coverage for Details, expandable quote, math, date/time, anchors/references, compact table and button styles.

- [ ] Add focused tests for each capability and its plain fallback/security gate.
- [ ] Run the three focused suites and confirm failures only where a real gap exists.
- [ ] If all cases already pass, record that no production implementation was needed for that capability.
- [ ] Commit focused contract tests.

### Task 2: Harden Details + chunking + bidi only where tests expose gaps

**Files:**
- Modify if required: `runtime/src/presentation/markdown-document-parser.ts`
- Modify if required: `runtime/src/presentation/agent-document-chunker.ts`
- Modify if required: `runtime/src/presentation/agent-document-text.ts`
- Modify if required: `runtime/src/presentation/agent-document-bidi.ts`
- Test: relevant runtime tests.

**Produces:** lossless Details behavior under malformed/nested/RTL/oversize inputs.

- [ ] Add RED tests for malformed/unclosed details, nested details budget behavior and Persian/RTL details.
- [ ] Patch only the minimal failing production paths.
- [ ] Re-run focused tests until green.
- [ ] Commit any real hardening separately from test-only audit work.

### Task 3: Document the public authoring and fallback contract

**Files:**
- Create: `docs/TELEGRAM_NATIVE_PRESENTATION.md`
- Update: this plan checklist as evidence lands.

**Produces:** reviewer-facing capability matrix and syntax examples.

- [ ] Document supported authoring forms (`details`, `tg-time`, `tg-math`, anchors/references, tables, trusted buttons).
- [ ] Document plain fallback for each primitive.
- [ ] Document security gates, URL policy, no-custom-color decision and bot/Core ownership boundary.
- [ ] Record exact tests and any production gaps fixed.
- [ ] Commit docs.

### Task 4: Full Core verification and PR evidence

**Files:** documentation only unless a regression appears.

- [ ] Run native-runtime focused tests.
- [ ] Run the repository's required lint/typecheck/build/test gates for the touched package/repo.
- [ ] Run `git diff --check` and inspect the complete diff for accidental release/soak changes.
- [ ] Push branch and open PR against current Core `main`.
- [ ] Add exact head SHA, CI run IDs, pass counts and known limitations to PR body/docs.
- [ ] Do not merge or publish a release as part of this PR.