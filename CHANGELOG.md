# Changelog

## Unreleased

- Fence MCP local workspace teardown and serialize per-server replacements/disconnects; retain current ownership through joined cleanup.

- Fence closing LSP workspaces, own processes before initialization completes, and join pending acquisitions so teardown cannot publish or leak a late client.

- Enable process admission at standalone Telegram-headless server startup before loading runtime modules; inherited disabled flags cannot bypass the production governor.

- Route MCP stdio through Core-owned workspace process groups with SDK framing, joined cleanup and retained admission; remove SDK launcher lease and best-effort descendant cleanup.

- Governed LSP service shutdown joins isolated process-group cleanup and retains admission until terminal closure and confirmed death; failed cleanup keeps accounting.

- Attach governed manual/model shell process groups to captured execution ownership and phase for OS pause/resume and abort-after-pause. Join terminal close and confirmed group cleanup before releasing admission; retire signal authority before PID reuse.

- Make the actual ShellTool timeout consume active execution time, preserving parent/child continuation while paused.

## v1.18.33-bot.13-pre.8 (2026-10-02)

Verified aligned runtime/SDK/native prerelease from `f110bd25419b6bedc40db36e9ae929bc4e52b9ac`. Compatibility, identity and checksum verification passed in release workflow `36979098365`; these are not final v1 release notes.

- Enforce combined block/inline nesting and actual quote/container block costs, preserve credits within text budgets, account for cumulative table spans/rowspans and safely flatten oversized spanning tables.
- Port PR #15 onto current pause/process/provenance architecture without its superseded shell cancellation patch. Reject non-finite, fractional, non-positive and oversized renderer budgets; verify pause between final chunks retains the same owned draft.

- Capture original root/producer run provenance at Core event publication, preserve it through live SSE/global delivery and SDK schemas, and require it for native execution routing. Completion/cancellation snapshots retain retired ownership; ordinary completion honors pause even without pending tools. Bot adoption remains gated on a verified aligned prerelease.

- Settle Runner cancellation when shell work finishes without opening readiness; cancel queued work without retaining a dead wait.
- Share bounded process termination between scope cleanup and explicit kill, retain governor admission through uncertain cleanup and post-spawn errors, and preserve output completion at `close`. Make output-reader listener attachment and cleanup registration atomic with cancellation, preventing a leaked reader from suppressing Linux/Bun terminal close. Deterministic reader-acquisition regression, Linux stress, CI and exact-candidate Railway health verification passed.

- Add a Core-owned Telegram-native document renderer: parse GFM plus Telegram Rich Markdown/HTML into semantic `AgentDocument` blocks, including math, custom emoji/time, references/anchors, media/figures, rich tables/lists, expandable quotes, details, collage/slideshow, maps and trusted interactive buttons; sanitize unsafe/untrusted links and actions, normalize Telegram Rich Message limits, and chunk final responses without breaking code, tables, lists, captions, credits, or grapheme clusters.
- Add Persian/RTL BiDi normalization for mixed-script output: auto-detect document direction, isolate LTR/RTL inline runs with Unicode LRI/RLI/PDI controls, align table cells by content direction, preserve code bytes, strip untrusted BiDi controls from prose, and mark streamed Persian Rich Markdown drafts as RTL.
- Persist finalized Markdown as explicit Telegram Rich Blocks while retaining native Rich Markdown for incremental draft streaming and exact-run Stop fencing.
- Fix deadline handling so pre-aborted parents cannot start work and cancellation rejects uncooperative requests promptly.
- Document the remaining pause/process migration, ownership audit and RC/soak/stable release gates.
- Full Bot pause/process adoption, intended shell-process suspension and persistent-daemon lifecycle remain release gates.
- Integrate live pause gates into the existing upstream session runners, model streams, tool bridges, and child scheduler; retain background ownership through follow-up delivery.
- Add run-fenced runtime pause/resume controls, protected recovery intent, workspace checks, and destructive cleanup before session deletion.
- Fence earlier model phases and ensure workspace disposal attempts all resource cleanup after runner errors.
- Add actual upstream runtime/API regressions and generated SDK wire-contract checks to CI. Full Bot delivery/control and custom-process adoption remain incomplete.
- Settle shell readiness when cancellation fences work before shell startup; preserve bounded existing-tool result finalization and truncation during destructive cleanup while rejecting new work and late callbacks.
- Add an invocation-scoped custom-tool process capability using the existing governor, captured runtime ownership, canonical workspace checks, pause-aware deadlines and bounded process-group cleanup. Bot tool migration and persistent-daemon integration remain release gates.
- Add a native runtime-control adapter with exact owned targets, serialized pause/resume requests, acknowledgment validation and fail-closed transport uncertainty.
- Hold queue/poll budgets, temporary-session completion and Telegram mutations through pause; preserve draft leases and recheck pause/fencing at actual admission boundaries.
- Exclude paused time from liveness/retry decisions, suppress destructive stuck decisions while held, and propagate native observer failure to deadlines and checkpoints.
- Fix the service-memory regression test to compare working set with the same raw sample rather than two independently changing samples.

## v1.18.33-bot.13-pre.7

- Core-owned bounded result polling with immutable run identity, cancellation, finite deadlines/attempts and stale-result rejection; application task polling retains its captured run fence.
