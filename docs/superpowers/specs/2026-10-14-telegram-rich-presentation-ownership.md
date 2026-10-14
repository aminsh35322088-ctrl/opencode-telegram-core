# Telegram Rich Presentation Ownership Design

Status: implemented and CI-verified; final branch sync/review pending.
Date: 2026-10-14
Branch: `feat/telegram-native-presentation-gaps`
Bot integration: `opencode-telegram-bot#191`

## Purpose

Make Core the single owner of Telegram-native parsing/rendering semantics and keep the Bot responsible only for run lifecycle and product UI. This prevents duplicate parsers/renderers from drifting apart and lets any Telegram client consume the same native-runtime presentation contract.

Official references:

- https://core.telegram.org/bots/api
- https://core.telegram.org/bots/api-changelog

## Existing Core capabilities (do not re-implement in Bot)

Core already owns and tests:

- Rich Messages / rich drafts
- `details`
- inline and block math
- native date/time
- anchors and anchor links
- references and reference links
- expandable block quotations
- rich tables and explicit compact tables
- trusted rich buttons and button styles
- marked/spoiler/code/semantic inline formatting
- Persian/RTL and bidi isolation
- chunking/limits/fallback plain rendering

These features remain Core-owned. Bot consumes them through `@opencode-telegram/native-runtime` instead of implementing a parallel AST/parser/renderer.

## Core gaps closed by PR #31

### 1. Markdown tables are compact by default

Standard GFM Markdown tables are dense data and are primarily rendered on mobile Telegram clients. Before this PR, Core emitted them as bordered tables but left `isCompact` unset, while Bot compensated by post-processing every native table and setting `is_compact: true`.

PR #31 moves that policy into Core:

- `tableBlock()` sets `isCompact: true` for ordinary GFM tables;
- explicit HTML rich tables keep attribute-driven semantics: `<table>` stays non-compact unless `compact` is present;
- renderer remains a pure mapping of `AgentBlock.isCompact` to Telegram `is_compact`;
- Bot #191 removes its post-render compact-table override only after consuming a published/pinned Core artifact containing this PR.

### 2. Public capability contract

Native runtime now exports an immutable build-time contract:

```ts
export const TELEGRAM_RICH_PRESENTATION_CAPABILITIES = {
  richMessages: true,
  details: true,
  expandableQuotes: true,
  math: true,
  dateTime: true,
  anchors: true,
  references: true,
  compactTables: true,
  richButtons: true,
  rtlBidi: true,
} as const;
```

This is not Telegram-client feature negotiation. It is an artifact contract for consumers and reviewers, backed by parser/renderer regression tests. It must not gain a capability unless tests prove the corresponding public surface.

## Bot ownership after the split

Bot PR #191 keeps only Bot-owned behavior:

- one run-owned Activity message and tool aggregation/dedup/redaction;
- Activity uses Core `details` rendering instead of Bot-owned `expandable_blockquote` formatting;
- reasoning lifecycle and persistence as an independent expandable quote;
- exact-topic `typing...` heartbeat;
- Remote Topic SDK/RPC wiring;
- governed Context Compaction UI and run ownership;
- Stop/run identity mapping;
- bot-owned deterministic menus/buttons and their routing;
- final-answer transport/finalization integration with Core renderer.

Bot must not add another parser for `details`, math, date/time, anchors/references, compact tables, or rich-button syntax.

## Compatibility and fallback

Core continues progressive enhancement:

- native rich blocks when supported;
- complete plain/message fallback when rich delivery fails;
- no body content may disappear because a client renders a rich primitive differently;
- no arbitrary text color support is invented because Bot API does not expose custom text colors for RichText.

## Security

- model output is parsed through Core's allowlisted Markdown/HTML parser;
- interactive buttons remain disabled unless the caller explicitly opts into trusted interactive buttons;
- URLs keep existing scheme validation;
- private provider chain-of-thought is outside this presentation contract;
- media/upload primitives remain outside this PR unless already covered by existing Core behavior.

## Testing contract

The Core PR must prove:

1. GFM Markdown table produces an Agent table with `isCompact: true` and Telegram `is_compact: true`.
2. Explicit HTML table without `compact` keeps existing explicit semantics; `<table compact>` remains compact.
3. Details parse/render/fallback remain unchanged.
4. Math/date-time/anchors/references/expandable quotes remain covered by existing or strengthened regression tests.
5. Capability descriptor exactly matches tested capabilities.
6. Persian/RTL rendering remains unchanged.
7. Full runtime test suite, typecheck/build/package/production graph verification remain green.

## Implementation and verification evidence

TDD evidence was intentionally retained in GitHub Actions history:

- RED run `38593967940`: **342 pass / 1 fail**; the only new failure was the expected missing `isCompact: true` on a GFM table. The explicit HTML-table test was already green.
- RED run `38594262691`: failed at typecheck because `TELEGRAM_RICH_PRESENTATION_CAPABILITIES` did not exist yet.
- Final GREEN run `38594717524` on head `635491ac6161f678142d322bd0308a488086a477`:
  - `validate`: success
  - TypeScript typecheck: success
  - Bun runtime suite: **344 pass / 0 fail**, 27 files, 1863 assertions
  - unbound session probe boundary: **3 / 3 pass**
  - Python repository suite: **326 / 326 pass**
  - toolchain/release contracts: success
  - `upstream-runtime`: success
  - `telegram-headless`: success, including production graph and Bot SDK surface verification

The dedicated ownership tests are green for:

- GFM compact-by-default table semantics;
- explicit HTML compactness remaining attribute-driven;
- public capability descriptor + details/expandable quote/math/date-time/anchor/reference smoke coverage.

### Branch freshness

At this evidence point, Core `main` advanced to `9ed7f4ec42701435d216497ddb3a7bfb709a800a` with documentation-only commits after the feature branch fork. GitHub compare reports the PR branch **8 commits ahead / 2 behind**. The PR remains Draft until it is synchronized onto the latest `main` and the final post-sync CI is green. The pre-sync green run above is evidence of implementation correctness, not permission to claim merge readiness.

## Documentation contract

The PR includes:

- this design;
- implementation plan/checklist;
- capability matrix;
- ownership split with Bot PR #191;
- fallback/security notes;
- exact TDD and CI evidence.

Before marking ready for review, update the branch-sync SHA and final post-sync CI run in the PR body.

## Non-goals

- no new Bot lifecycle logic in Core;
- no Activity aggregation in Core;
- no model-generated privileged callback actions;
- no arbitrary custom text colors;
- no duplicate Bot-specific parser/render layer;
- no production deploy or stable release as part of this PR itself.
