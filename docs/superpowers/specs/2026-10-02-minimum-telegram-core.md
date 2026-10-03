# Minimum Telegram Core: consumer audit and production design

The product is a minimal Telegram headless runtime. Every shipped capability must serve current Telegram production, a committed target Telegram feature with a concrete dependency/consumer path, or an internal requirement of either. Upstream parity is not a requirement. Bot remains read-only and migration is excluded. Implementation and verification are performed inline by the primary agent.

## Evidence baseline

Baseline main: `640becc950605790b1fff368557885833886704a`. Candidate base: stabilization checkpoint `183597576af6ed6cfb343bfce3a4305774c4a377`. Bot: `471f644aefe44950f07c2e11effced4ffca7d525`. Upstream: `51ef4be1d3c122f18fefb510dca8d778571f4f18`. Paths in the consumer column are in the Bot checkout. Classification measures reachable functionality, not evidence that a user has recently exercised it. Negative findings cover `src`, `.opencode`, Dockerfile, entrypoint and runtime configuration, including dynamically loaded Bot services in custom tools.

| Subsystem | Class | Concrete consumer or dependency evidence | Minimum scope |
| --- | --- | --- | --- |
| Session lifecycle/history/commands | A | `src/app/services/session-service.ts`, `session-autonomy-service.ts:39-69`, `session-error-recovery-service.ts:32-84`, `.opencode/tools/session-extended.ts:72` | Bot SDK contract, history polling and durable session SSE |
| Provider/model catalog and inference | A | `model-capabilities-service.ts:28`, `model-context-limit-service.ts:34`, `model-selection-service.ts`, `custom-provider-service.ts:811-839` | Config catalog plus model execution; arbitrary selectable upstream catalog models and pinned plugin providers remain supported |
| File HTTP APIs | C | No `client.file`/`client.find` or raw `/file`/`/find` callers in consumer sources; file services use filesystem and custom tools | Exclude HTTP routes; retain agent file tools |
| File/workspace operations | A | `.opencode/tools/file.ts`, `file-browser-service.ts`, `file-download-service.ts`; prompts pass file parts | Retain read/edit/write/search, attachments, snapshots, truncation and workspace guard |
| Tool execution | A | `src/core/native-core-service.ts:107-138` dispatches agent prompts; `src/opencode/client.ts` exposes model tools | Preserve actual agent registry and permission/lifecycle invariants |
| Shell execution | A | `.opencode/tools/git.ts:22`, `.opencode/tools/browser.ts:60`, agent bash permissions in `src/opencode/managed-policy.ts:34-100` | Governed bash and custom invocation execution; manual shell HTTP API has no caller |
| Custom tools | A | `railway-entrypoint.sh:101-105` installs `.opencode/tools`; `src/opencode/client.ts:101`; dynamic Bot module loading in `bot.ts` | Preserve plugin tool loading and custom process capability |
| MCP local stdio | B | `mcp-server-service.ts:35,174-198,541,603`; managed local config and extension services | SDK framing, owned stdio groups, acquire/close fencing |
| MCP remote HTTP/SSE | B | `mcp-server-service.ts:49-58,430-468,905`; remote endpoint/config materialization | Both SDK transports, tools/resources/instructions |
| MCP OAuth/callbacks | B | `mcp-server-service.ts:947,974,1252`; Telegram callback flow in `src/i18n/en.ts:535` | start/callback/remove; credentials/state lifecycle |
| MCP browser opener | C | Bot uses `auth.start` and forwards authorization URL to Telegram; no `mcp.authenticate` call | Remove automatic OS browser opener/authenticate route; retain callback listener used by start flow |
| Playwright/browser custom tool | B | Dockerfile installs `@playwright/cli@0.1.18` and Chromium; `.opencode/tools/browser.ts:22,60` | External custom tool execution; no embedded Playwright dependency needed |
| Persistent browser processes | B | `.opencode/tools/browser.ts:10-11,18-19,29,60` exposes open/tab/new and named persistent sessions | Real lifecycle gate; not confused with MCP OAuth opener |
| LSP | B | Dockerfile and `railway-entrypoint.sh:13` enable `OPENCODE_EXPERIMENTAL_LSP_TOOL`; managed policy `:16` allows tool | Agent LSP and owned workspace services; no diagnostic HTTP route |
| Code Mode / TypeScript compiler | C | No CODE_MODE configuration, enable flag or execute-tool caller in Bot runtime/config/tools; ordinary tools are used | Exclude CodeMode dynamic import, tool descriptor and TypeScript compiler; reject enable flag |
| Native FFF search/index backend | C | No Bot FFF integration or backend-specific API; file search is A, served by existing upstream ripgrep fallback | Retire alternative native backend/thread lifecycle; preserve actual file search |
| Native v2 transport adapters | D | `src/core/native-core-service.ts:143` injects a null session client and uses the SDK prompt adapters instead; no SessionEventPump constructor | Move exports/compiled files to compatibility tooling |
| Live execution/pause/resume HTTP APIs | B | No current Bot calls, but production `TelegramNativeCore.pauseRun/resumeRun/inspectExecution` → `OpenCodeExecutionClient` → `OpenCodeExecutionControlPort` requires a transport to the separate Bun runtime. `docs/PAUSE_RESUME.md` and migration design require True Pause/Resume before Bot adoption | Keep three legacy wrappers around existing runtime authority; test production physical pause, recovery, child semantics and exact ownership. See `docs/TELEGRAM_EXECUTION_CONTROL.md` |
| PTY | C | No PTY SDK/raw callers or tool exposure; upstream core PTY only enters through full server/v2 location composition | Exclude PTY handlers/services/native adapters; reject unsupported API |
| Subagents | A | Agent task tool available under allow-all managed policy; `.opencode/tools/session.ts`, autonomy `session.children` | Existing bounded scheduler, run ownership, pause/cancel and child events |
| Result polling | A | `src/core/native-core-service.ts` owns task polling; scheduled parse/dispatch uses Core-owned tasks | Keep native poller and session status/history |
| Event streaming/SSE | A | `src/opencode/topic-event-bus.ts:183` (`eventApi.subscribe`) subscribes per directory; native v2 session replay is not instantiated by the Bot | Keep live directory SSE; native v2 durable-session transport is compatibility/debug-only |
| Event provenance | A | Core root/producer provenance consumed by fenced native event router; Bot topic event bus and Core-native dependency path | Preserve patched publisher identity |
| Pause/resume/abort | B | `.opencode/tools/session-extended.ts`, Bot SDK execution contract; `native-core-service.ts:240` abort | Current Bot pause uses abort and resume sends a continuation prompt (`src/bot/commands/pause-command.ts`); preserve that workflow. Live fiber control is required by the target native-control migration and remains supported in production, without modifying current Bot behavior |
| Temporary sessions | B | `scheduled-task-schedule-parser-service.ts:197`, `src/core/opencode-session-port.ts:11-44` | Core-owned workspace-bound temporary session cleanup |
| Permissions/questions | A | `attach-service.ts:187,216`, permission/question UI services and `managed-policy.ts` | Pending list/reply/reject and interactive agent tools |
| Skills/plugins/extensions | B | `skills-catalog-service.ts:53`, `custom-provider-service.ts:830-839`, extension registry reloads config | Filesystem skill discovery, pinned plugin loading/auth hooks and custom tools |
| Git/worktrees | B | `/worktree` registered by `src/bot/routers/command-router.ts:115`; `worktree-service.ts:72` runs git; `.opencode/tools/git.ts` and GitHub tools | Agent git/snapshot/worktree filesystem support; exclude unused upstream experimental worktree HTTP service |
| Utilities/helpers | A | File mutation snapshot/truncation, LSP launch/download, plugin package resolution, MCP callback dependencies | Keep only dependencies of retained execution; governor mandatory |
| Background/persistent daemons | B | Browser above; MCP stdio and LSP service lifetime; Bot SSH multiplexing/Tailscale in Bot-owned services/entrypoint | Core owns its actual service groups; no claim that Bot-owned Tailscale/SSH is a Core daemon |
| Native renderer/RTL | A | `native-core-service.ts` imports grammY ports and `TelegramNativeCore` | Preserve renderer, draft/final limits, RTL and trusted controls |
| Scheduler/Topics/isolation | A | `native-core-service.ts` workers/bindings; `scheduled-task-schedule-parser-service.ts:170` Core-owned task dispatch | Preserve all native routing, fencing, admission and cleanup |
| TUI and TUI HTTP control | D | No Telegram caller; full upstream CLI debug artifact only | Exclude graph/routes in production |
| Web UI/embedded frontend | D | No Telegram caller; previous headless flags disabled UI but server still imports UI fallback | Exclude UI handler graph entirely |
| Desktop | C | No Bot runtime import, Docker installation or call-site | Not shipped |
| Interactive/full CLI | D | Bot spawns only `opencode serve --port`; `src/opencode/process.ts:104-109` | Separate compatibility artifact |
| Native JSON-line transport/reconciler and conformance helper | D | No Bot constructor/caller/import; native Core uses WorkerOutboundGate internally, which is retained. Source-only test/smoke consumers use these adapters/constants | Exclude production exports/emitted modules; retain debug entrypoint and all original invariants |
| Release build identity | A | `scripts/package-release.sh` and `verify-release.sh` require immutable source/upstream/SDK identity for published artifacts | Tiny build-info query only |
| Debug CLI | D | No Bot `debug` invocation; release scripts require build identity | Keep tiny identity query internally for release validation; exclude unrelated debug commands |
| mDNS discovery | C | Bot URL is fixed loopback `railway-entrypoint.sh:4`; spawn args contain no mDNS | Remove Bonjour and reject option |
| v2 routes/control-plane/remote workspace routing | C | Consumer uses legacy SDK endpoints and directory binding, with Tailnet SSH through dedicated Bot services | Exclude unrelated v2 server, remote workspace proxies and move-session APIs |
| Upstream sharing/autoshare | C | No share/unshare API caller in Bot/custom tools; consumer shares files via Telegram | Exclude upload/sync service, reject sharing configuration |
| Self-upgrade API/service | D | Docker materializes pinned release in builder; no global upgrade caller | Exclude runtime installation/upgrade service |
| Provider auth/config mutation HTTP APIs | C | Bot stores credentials and materializes config overlay, uses `config.get/providers` and `global.dispose`; no upstream auth set/provider-auth call | Exclude unused handlers; preserve internal provider/plugin auth |
| Upstream account/console service | C | No account login/org/device-code flow, active-org state or Console token materialization in Bot. Bot writes provider/auth overlays through custom-provider service. Legacy Config branch alone fetches an active Console organization, independently of provider SDK execution | Exclude active-org remote config/device login/token refresh service. Retain provider credentials, OAuth plugins and local config precedence; reject Console-token integration and persisted active-organization configuration |

## Build graph and strategy

Baseline measured locally: 124,356,736 bytes, as opposed to the earlier reported 124,340,352 bytes (models.dev snapshot is fetched at build time). The Bun executable includes engine overhead, so binary size is not the sum of application source sizes. Dynamic imports in a compile build are bundled; moving a module behind `import()` does not remove it.

Prefer a production-only downstream composition patch over runtime feature hiding. Reuse upstream handler bodies, narrowing their API groups and dependencies. Shared lifecycle implementations and native invariants remain intact; checkpoint type errors are corrected without changing cleanup semantics. Compatibility/debug compilation uses an independent upstream materialization, never the production-pruned tree. Preserve local directory binding, authentication, schema validation, CORS, compression, fence middleware and lifecycle teardown.

Ranked candidates by lifecycle/attack surface, to be confirmed against bundle contribution measurements:
1. Full v2 HTTP server/location graph, PTY native adapter/tickets and remote workspace control-plane.
2. Unused provider SDKs if consumer catalog/config proves exclusion; otherwise preserve selectable inference.
3. Experimental/TUI/sync/file/provider-auth routes and their handler-only services.
4. Sharing/upload sync, self-upgrade and workspace worktree management APIs.
5. UI fallback assets/proxy, documentation aggregation and mDNS.

The prompt's reference directory feature currently asks the entire v2 location map for `Reference.Service`. Narrow that map to Location, PluginInternal, Reference and PluginV2 nodes, preserving the config/plugin producers and their dependency paths. This removes unused service materialization without reimplementing reference discovery.

Unsupported endpoints return a clear non-success response and never start processes. Unsupported configuration/options fail explicitly. Do not weaken shell/MCP/LSP cancellation/ownership or change Bot behavior. Plugin capabilities remain constrained by the supported production API; arbitrary plugin code is not evidence for every upstream route.

## Lifecycle scope and readiness

PTY stabilisation disappears only after compiled graph and negative API checks prove exclusion. Persistent Playwright remains required and is not made safe merely by killing a launcher group. Raw `execFile` in the current Bot custom tools is evidence of a remaining integration boundary, not permission to silently disable browser capability. MCP/LSP workspace acquire/teardown race gates remain until exercised and fixed. Actual compiled Railway validation is mandatory; native smoke does not satisfy it. No RC/stable claim with any failed prior invariant or incomplete required process ownership.

The current production SDK call inventory has 41 members; see [exact call-sites](../../BOT_CORE_CALLS.md). The contract now separately records 41 current calls and three production-required target migration APIs. The complete generated SDK retains compatibility types; those types do not enable retired production server APIs.
