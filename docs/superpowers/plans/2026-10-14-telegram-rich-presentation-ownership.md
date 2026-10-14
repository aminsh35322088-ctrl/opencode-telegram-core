# Telegram Rich Presentation Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Core the single source of truth for Telegram-rich presentation primitives, move compact Markdown-table policy out of Bot, and expose a tested capability contract.

**Architecture:** Keep parsing/rendering semantics in `@opencode-telegram/native-runtime`; Bot remains a consumer. Change only Core presentation code and tests. Existing rich primitives stay behavior-compatible; the only presentation behavior change is GFM Markdown tables becoming compact by default.

**Tech Stack:** TypeScript, `@opencode-telegram/native-runtime`, grammY rich-message types, unified/remark parser, Vitest/runtime tests.

**Spec:** `docs/superpowers/specs/2026-10-14-telegram-rich-presentation-ownership.md`

## Global Constraints

- Do not duplicate Bot lifecycle/activity logic in Core.
- Existing `details`, math, date/time, anchors/references, expandable quotes, buttons, fallback and RTL behavior must remain compatible.
- Standard GFM Markdown tables must set `isCompact: true`; explicit HTML table semantics remain attribute-driven.
- Capability descriptor may only claim behavior covered by tests.
- No arbitrary custom text-color API is introduced.
- No privileged model-generated button behavior is enabled.

## Review Focus

- A normal Markdown table becomes compact without altering cells, alignment, header flags or fallback text.
- An HTML `<table>` without `compact` does not silently gain a semantic attribute it did not request.
- Invalid/unsupported rich syntax still degrades to visible fallback content.
- Capability metadata cannot drift from tested parser/renderer behavior.
- Persian/RTL and chunking limits remain unchanged after the compact-table policy moves.

---

### Task 1: Lock compact Markdown-table semantics

**Files:**
- Modify: `runtime/src/presentation/markdown-document-parser.ts`
- Test: `runtime/test/markdown-document-renderer.test.ts`
- Test: `runtime/test/rich-blocks.test.ts` if renderer-level assertion is needed

**Interfaces:**
- Consumes: existing `AgentBlock` table shape with `isCompact?: boolean`.
- Produces: GFM Markdown tables parsed with `isCompact: true`.

- [ ] **Step 1: Write the failing parser regression test**

Add a test named `markdown tables are compact by default without changing table semantics` that parses a GFM table and asserts:

```ts
expect(table).toMatchObject({ type: "table", isBordered: true, isCompact: true })
```

Also assert the existing header/alignment/cell text shape is unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run the runtime test command targeting `markdown-document-renderer.test.ts`.
Expected: the new `isCompact: true` assertion fails on current Core.

- [ ] **Step 3: Implement the minimal parser change**

In `tableBlock(node, context): AgentBlock`, return Markdown tables with `isCompact: true` in addition to existing `isBordered: true`.

- [ ] **Step 4: Prove explicit HTML table semantics remain unchanged**

Add/retain assertions that `<table>` without `compact` has no `isCompact`, while `<table compact>` has `isCompact: true`.

- [ ] **Step 5: Run focused parser/renderer tests and verify GREEN**

Expected: all table parser/renderer tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat(runtime): make markdown tables compact by default`

### Task 2: Add a tested Core capability contract

**Files:**
- Create: `runtime/src/presentation/telegram-rich-capabilities.ts`
- Modify: `runtime/src/index.ts`
- Create or modify: `runtime/test/telegram-rich-capabilities.test.ts`

**Interfaces:**
- Produces: `TELEGRAM_RICH_PRESENTATION_CAPABILITIES` exported from native runtime.
- Consumers: Bot PR #191 documentation/integration and future clients/reviewers.

- [ ] **Step 1: Write the failing export test**

Test imports `TELEGRAM_RICH_PRESENTATION_CAPABILITIES` from runtime public index and asserts exact booleans for:

```ts
richMessages
details
expandableQuotes
math
dateTime
anchors
references
compactTables
richButtons
rtlBidi
```

- [ ] **Step 2: Run the focused test and verify RED**

Expected: export/module does not exist.

- [ ] **Step 3: Implement the immutable descriptor**

Create:

```ts
export const TELEGRAM_RICH_PRESENTATION_CAPABILITIES = { ... } as const;
```

and export it from `runtime/src/index.ts`.

- [ ] **Step 4: Bind capability claims to existing behavior tests**

In the capability test file, add small smoke assertions using public parser/renderer APIs for `details`, expandable quote, math, date/time, anchor/reference, compact table, and trusted rich button rendering. Reuse public APIs; do not duplicate full existing test suites.

- [ ] **Step 5: Run capability + existing rich presentation tests and verify GREEN**

Expected: capability test and rich parser/renderer suites pass.

- [ ] **Step 6: Commit**

Commit message: `test(runtime): publish Telegram rich capability contract`

### Task 3: Regression gate and ownership documentation

**Files:**
- Update: `docs/superpowers/specs/2026-10-14-telegram-rich-presentation-ownership.md`
- Update: this plan checklist
- Update PR body with final evidence

**Interfaces:**
- Produces: auditable Core PR that Bot #191 can depend on without reconstructing chat history.

- [ ] **Step 1: Run focused presentation suites**

Run parser, rich blocks, rich inline, message renderer, Persian bidi, and chunker tests.

- [ ] **Step 2: Run full Core verification**

Run repository lint/typecheck/build/package verification and full runtime test suite exactly as CI does.

- [ ] **Step 3: Verify diff and public package surface**

Run `git diff --check`; verify the new capability export is present in the packaged native-runtime artifact and no unrelated generated files are included.

- [ ] **Step 4: Record exact evidence**

Add commit SHA, test counts, CI run IDs, and any artifact/pre-release identity to the Core PR body and spec verification section.

- [ ] **Step 5: Update Bot #191 dependency note**

Document that Bot removes local compact-table post-processing only after consuming a Core artifact containing this PR.

- [ ] **Step 6: Final independent review**

Review ownership boundaries: Core owns semantic parsing/rendering; Bot owns run aggregation/lifecycle/UI. Reject any duplicated rich-parser implementation found in Bot #191.
