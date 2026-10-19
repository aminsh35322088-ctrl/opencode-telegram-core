# OpenCode upstream review — 2026-10-19

## Decision

Upgrade the Core's pinned OpenCode 1.x baseline from `v1.18.33` to `v1.19.3` in a review-only PR. The lock uses `1.19.3-bot.13-review` only as an internal build identity. Do not change the production Bot pin or publish a Core release from this branch.

The newest overall upstream release is OpenCode `v2.0.32`, but v2 changes the server API/client contracts and plugin API. The current Core's 15 downstream patches plus Telegram-headless composition are written against the v1 server/runtime. The Telegram-headless patch does not apply cleanly to v2, so changing only `upstream/lock.json` to v2 would be unsafe.

## Relevant upstream improvements

| Upstream change | Core relevance | Disposition |
|---|---|---|
| v1.19.3: build reasoning variants from model `reasoning_options`, while preserving configured overrides | Makes model reasoning controls follow declared provider capabilities rather than only static catalog variants | Included by the v1.19.3 baseline upgrade |
| v1.19.0: validate PTY connection origin and tickets before checking PTY existence | Security hardening, but PTY routes are excluded from the Telegram production profile | Upstream included; production profile continues to omit PTY |
| v2.0.32: recover/continue Gemini sessions after intermittent `MALFORMED_RESPONSE` | Relevant to model reliability and incomplete turns | Candidate for a separate targeted backport after tracing the exact v1 provider path and adding deterministic regression fixtures |
| v2.0.30: skip unsupported MCP catalog/codemode calls, improve elicitation capability declarations, accept `*.localhost` OAuth token endpoints | Relevant to MCP interoperability | Candidate for a separate MCP compatibility PR; preserve Core's topic-scoped ownership, timeout, and retirement guarantees |
| v2.0.30: separate MCP startup/catalog/execution timeout budgets | Relevant to hanging or slow MCP servers | Candidate for a separately tested change; do not broaden a deadline without matching process-retirement tests |
| v2.0.29: bounded continuation after output-token limits | Could reduce truncated answers and incomplete tool arguments | Defer: v2 uses a different session runner/continuation architecture; do not transplant without proving idempotency and tool-call safety |
| v2.0.28: continue split Gemini/Vertex responses and tolerate dropped streams after continuation checkpoints | Relevant to long model responses | Defer with the continuation work; must prove no duplicate output, tool execution, or stale-session writes |
| v2.0.28: disable Bun fetch idle timeout for provider requests and raise streamed-chunk timeout | Could reduce false stream termination, but can also prolong stuck requests | Do not change timeouts in this upgrade; Core already has its own bounded run and cleanup contracts |
| v2.0.27: built-in worktree tools and automatic project cleanup | Potential isolation and workspace-management improvements | Defer: requires a complete audit of workspace ownership, binding-generation fencing, and cleanup proof before exposing any worktree mutation |
| v2.0.27: surface errors that occur before/between model steps | Useful for Telegram failure visibility | Audit separately against Core's event-provenance and terminal-event contracts |
| v2.0.32: experimental server-brokered voice sessions | Not required by the current Core Telegram execution contract | Not included |

## Compatibility evidence

- Upstream v1.19.3 tag resolves to commit `e3c4eb242585dcd77be1a867391b7c25fd47ce52`.
- The 15-patch Core series was checked against that exact source. The only patch drift was the dependency-patch registration context in `0007-telegram-service-retry-cancellation.patch`; it was rebased without changing the cancellation behavior.
- The Telegram-headless composition patch was rebased for upstream's already-removed sharing bootstrap and then checked against a freshly materialized v1.19.3 tree.
- The first compiled runtime was `115,996,800` bytes against the `120,000,000`-byte ceiling, leaving only `4,003,200` bytes of headroom; avoid bundling extra large features into this baseline PR.
- Existing runtime, SDK, and native package identities must still be rebuilt and verified as one unit. Prior Railway soak evidence does not qualify this new upstream candidate.

## MCP readiness finding

The v2 startup/catalog race discussed in [upstream issue #51812](https://github.com/anomalyco/opencode/issues/51812) is not a reason to add a sleep to the pinned v1.19.3 runtime. The exact v1.19.3 source follows an awaited, directory-scoped path:

- `MCP.tools()` calls `InstanceState.get(state)`.
- `InstanceState.get` awaits the directory-keyed `ScopedCache`; its lookup runs the `MCP.state` initializer.
- `MCP.state` loads the configured MCP entries and awaits each `create(...)` operation before the initialized state exposes connected clients and cached tool definitions.
- `SessionTools.resolve()` reads `mcp.clients()` and then `mcp.tools()` from that same state, rather than racing a detached catalog request.
- Each connection attempt is bounded by the configured timeout or the 30-second default, and a failed connection closes its transport.

Disposition: no arbitrary startup delay and no v2 initialization transplant. Keep timeout and failed-transport cleanup guarantees. Add a v1 runtime patch only if a deterministic reproduction shows the first prompt can proceed while tool initialization is still pending.

Source inspection:
- [MCP service, v1.19.3](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/mcp/index.ts)
- [Directory-scoped instance state, v1.19.3](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/effect/instance-state.ts)
- [Prompt tool assembly, v1.19.3](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/session/tools.ts)

## Sources

- Official changelog: https://opencode.ai/changelog
- OpenCode v2 migration guide: https://opencode.ai/v2/docs/migrate-v1/
- MCP configuration and timeout documentation: https://opencode.ai/v2/docs/mcp-servers
- Managed policies: https://opencode.ai/v2/docs/policies/
