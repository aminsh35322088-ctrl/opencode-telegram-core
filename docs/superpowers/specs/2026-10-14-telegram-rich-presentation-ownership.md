# Telegram Rich Presentation Ownership Design

Status: approved split from Bot PR #191; implementation pending plan review.
Date: 2026-10-14
Branch: `feat/telegram-native-presentation-gaps`

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

These features remain Core-owned. Bot should consume them through `@opencode-telegram/native-runtime` instead of implementing parallel AST/parser/renderer logic.

## Core gaps to close

### 1. Markdown tables should be compact by default

Standard GFM Markdown tables are dense data and are primarily rendered on mobile Telegram clients. Core currently emits them as bordered tables but leaves `isCompact` unset; Bot compensates by post-processing every native table and setting `is_compact: true`.

Move that policy into Core:

- `tableBlock()` in the Markdown document parser sets `isCompact: true` for ordinary GFM tables;
- explicit HTML rich tables keep their existing `compact` attribute semantics;
- renderer remains a pure mapping of `AgentBlock.isCompact` to Telegram `is_compact`;
- Bot removes its post-render compact-table override after consuming the new Core artifact.

### 2. Capability contract / regression matrix

Add a small exported immutable capability descriptor from native runtime so consumers and reviewers can see what presentation primitives the artifact guarantees. This is not runtime feature negotiation with Telegram clients; it is a build-time contract for the Core package.

Proposed export:

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

The matrix is backed by tests for parsing, rich rendering, fallback rendering, and character/block accounting. It must not claim a feature unless the current artifact has a regression test proving it.

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
7. Full runtime test suite, typecheck/build/package verification remain green.

## Documentation contract

The PR must include:

- this design;
- implementation plan/checklist;
- capability matrix;
- ownership split with Bot PR #191;
- fallback/security notes;
- exact test/CI evidence and artifact version/commit when complete.

## Non-goals

- no new Bot lifecycle logic in Core;
- no Activity aggregation in Core;
- no model-generated privileged callback actions;
- no arbitrary custom text colors;
- no duplicate Bot-specific parser/render layer.
