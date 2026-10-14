# Telegram-Native Presentation Contract

Status: approved project direction; implementation/review branch
Date: 2026-10-14

## Purpose

Keep Telegram presentation primitives owned by Core/native-runtime instead of duplicating parser/rendering semantics in the bot. The bot remains responsible for bot-specific run UX (reasoning lifecycle, activity aggregation, topic typing, menus, Stop and Remote Topic wiring), while Core owns model-authored document parsing, Telegram Rich Message mapping, chunking/fallback and presentation compatibility.

Official references:
- https://core.telegram.org/bots/api
- https://core.telegram.org/bots/api-changelog

## Ownership boundary

### Core/native-runtime owns

- `AgentDocument` / `AgentInline` semantic IR.
- Markdown/HTML -> semantic document parsing.
- Telegram Rich Message compilation.
- Details blocks and fallback text.
- Expandable block quotations as a rendering primitive.
- Inline/block math.
- Native date/time text.
- Anchors and references.
- Compact tables.
- Telegram-defined rich button styles where interactive buttons are explicitly enabled by a trusted caller.
- Rich-message character/block/nesting budgets, chunking and plain fallback.
- Persian/RTL direction handling at the semantic renderer boundary.

### Bot owns

- Which run events are user-visible.
- Visible reasoning lifecycle and separation from final answer.
- One-run Activity aggregation and redaction.
- Topic-local `typing...`.
- Context Health / Compact Context UI.
- Stop, menus, callback ownership and destructive-action authorization.
- Remote Topic SDK/Worker routing.
- Choosing when to use bot-owned buttons; model output never gets callback ownership.

## Capability audit against Core main

Core main already implements the production primitives required by the project:

- `details` in the semantic document, parser, rich renderer, plain fallback, bidi traversal and chunker.
- `quote.expandable` -> Telegram `expandable_blockquote`.
- `math` -> Telegram `mathematical_expression` for inline and block forms.
- `date_time` -> Telegram `date_time` RichText with explicit Unix time and validated format.
- `anchor`, `anchor_link`, `reference`, `reference_link`.
- `table.isCompact` -> Telegram `is_compact`.
- Telegram rich button styles (`primary`, `success`, `danger`, `link`) behind `allowInteractiveButtons`.
- safe URL handling and trusted-button gating.

Therefore this PR must not reimplement those capabilities. Its code work is limited to real gaps found by regression tests or missing public contract coverage.

## Security invariants

- No arbitrary text-color API is invented; Telegram does not expose custom RichText colors.
- Model-authored content cannot enable interactive buttons unless a trusted caller explicitly opts in.
- Callback data remains bot-owned.
- Unsafe URLs degrade to visible text rather than becoming actions.
- Invalid rich constructs retain visible fallback content.
- Private provider chain-of-thought is outside the presentation IR contract.

## Compatibility / fallback

Every semantic construct must retain a readable non-Rich fallback:

- details -> summary + body;
- math -> expression text;
- date/time -> supplied visible text;
- anchors -> no invisible junk in plain output;
- reference links -> visible label/text;
- compact table -> normal table/preformatted fallback;
- styled button -> same trusted action, style treated as presentation only.

Rich client behavior is progressive enhancement; loss of a Rich Message feature must not lose content.

## Required regression coverage

The branch must prove, using native-runtime tests:

1. Details preserve summary/body in native and plain outputs, including nested/code/list content.
2. Malformed/unclosed rich HTML does not erase content.
3. Persian/RTL content inside Details preserves direction semantics.
4. Explicit native time validates timestamp/format and invalid forms remain visible.
5. Math is explicit/semantic and ordinary currency text is not misclassified.
6. Anchors/references render correctly and unresolved links degrade safely.
7. Compact table remains a presentation hint and does not change fallback semantics.
8. Button styles remain gated by trusted interactive-button opt-in.
9. Rich limits/chunking continue to account for nested Details.
10. Existing renderer, stream and message-renderer suites stay green.

## Documentation contract

This PR is intended for later independent review by Codex/another strong model. The PR must contain:

- this ownership/capability spec;
- an implementation checklist with exact test evidence;
- adopted/already-present/deferred capability matrix;
- parser syntax and fallback examples;
- security notes and explicit non-goals;
- CI run identifiers and final head SHA.

## Non-goals

- Bot-specific Activity aggregation.
- Bot-specific reasoning lifecycle.
- Bot menus or callback routing.
- Custom text colors.
- New Mini App workflows.
- Arbitrary model-generated media/actions.
- Rewriting already-correct Core primitives only to mirror bot code.

## Success criteria

Core exposes one authoritative, well-tested Telegram presentation contract, and the bot can delete/avoid duplicate parser/rendering logic while retaining only bot-specific orchestration.