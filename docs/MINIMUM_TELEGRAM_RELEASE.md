# Minimal Telegram Core release scope

This candidate is a production-scope correction, not a claim of RC/stable readiness.
Bot commit `471f644aefe44950f07c2e11effced4ffca7d525` was inspected read-only. No Bot
source, feature behavior, pins, migration, deployment or Railway service was changed.
The single PR includes the cumulative stabilization checkpoint `183597576af6ed6cfb343bfce3a4305774c4a377`.

## Actual production contract

The [41 SDK member call-sites](BOT_CORE_CALLS.md) and [complete subsystem audit](superpowers/specs/2026-10-02-minimum-telegram-core.md)
define the scope: legacy sessions/history/status/prompts/commands/abort/fork/revert,
model catalogs/inference, agent file/shell/custom tools, directory SSE and provenance,
permission/question interaction, agent/skill/plugin discovery, local/remote MCP and
Telegram-mediated OAuth, LSP, subagents, Topics, scheduling, temporary sessions,
result polling, renderer/RTL and Core's admission/isolation/cleanup primitives.

Bot Git/worktree/GitHub/Tailscale workflows remain supported through their actual
filesystem, shell and custom-tool paths. Bot-owned Tailscale/SSH daemons are distinct
from Core service processes. Playwright CLI and Chromium are installed by the Bot;
Core embeds neither. The browser custom tool supports persistent named browser
sessions and is required. Removing MCP's OS browser opener does not remove or
stabilize those browser sessions.

The Bot currently implements pause by aborting; resume sends a continuation prompt.
It does not invoke Core's live `execution/pause/resume` HTTP endpoints. The old
44-member SDK contract mixed those future migration APIs with current consumption.
The production contract is corrected to 41. Internal captured execution control,
phase fencing and previously closed pause invariants are preserved; debug APIs and
the full compatibility suite still exercise live control. No Bot behavior changes.

## Removed from production

- PTY service, native Bun PTY library, ticket authorization and terminal routes.
- Full v2 server, control-plane/remote workspace routing, workspace proxy/sync and
  experimental worktree/workspace management. Reject workspace routing/config.
- File/find/provider-auth/config-mutation HTTP APIs; actual file tools, inference,
  provider credentials and plugin hooks remain supported.
- TUI/control routes, UI fallback/proxy, documentation route, embedded/frontend
  composition and interactive CLI graph. The previous runtime already embedded no
  frontend assets; this additionally removes their server composition.
- Sharing/autoshare upload/sync services, self-upgrade/installation service, mDNS/
  Bonjour, Console organization/device-login/remote-config/token-refresh integration.
- Code Mode's dynamic import, interpreter and TypeScript compiler. Its enable flag
  fails clearly instead of exposing a partially working execute tool.
- FFF native accelerated search/index. Required search uses existing upstream
  ripgrep; it is not a replacement implementation. A native index/thread lifecycle
  and library disappear without removing read/edit/write/glob/grep.
- Native v2 session client/event pump production exports and emitted Node modules.
  They remain in the independent debug entrypoint. Unused native JSON-line transport, run reconciliation adapter and conformance helper also move there; the internally used worker outbound gate remains.

The legacy composed endpoint count falls from 130 to 41; the separate v2 server is
also excluded entirely. This count excludes duplicate public schema-only aliases.
Unsupported production routes return non-success responses. Enable flags for
removed behavior fail explicitly; persisted Console organization selection returns
a configuration error without importing its account/network services. Authentication, local directory binding,
compression/CORS, ownership fences and destructive cleanup remain intact.

## Build graph and size

| Measurement | Bytes |
| --- | ---: |
| Published pre.8 runtime (release metadata) | 124,340,352 |
| Unchanged local pre-slimming build | 124,356,736 |
| Same checkpoint/frozen catalog, broad server composition | 124,360,832 |
| Slim candidate | 113,887,360 |
| Reduction versus published pre.8 | 10,452,992 (8.41%) |
| Minimal Bun 1.3.14 compiled executable | 94,582,912 |
| Separate full debug CLI (not released in production package) | 150,435,968 |

The engine alone accounts for about 83% of the remaining standalone executable.
The catalog remains necessary because Telegram supports generic provider/model
selection and custom pinned providers. A frozen 5,310,394-byte models.dev input is
checked in (SHA256 `81f8b4433bbcd07c4a2912b2d1abc32b48e0c20ec1db4aedaa33b03fcf098c06`).
Builds no longer fetch a varying catalog. The production budget is tightened from
140,000,000 to 120,000,000 bytes; graph exclusion is enforced independently of size.

Ranked removed contributors:

| Subsystem | Before path/reachability | Dominant contribution | Result |
| --- | --- | ---: | --- |
| FFF native search | Server → legacy prompt/reference → PluginInternal/FileSystem/Search; alternative backend | 5,576,816-byte native library | Use existing ripgrep backend; native graph excluded |
| Code Mode | ToolRegistry dynamic import, bundled even when flag false | TypeScript: 9,065,569 source bytes / 3,610,729 emitted JS bytes, plus interpreter | Import/descriptors excluded, enable flag rejected |
| PTY | Broad Server + complete location map | 610,024-byte Rust PTY library, plus services/handlers | Service, adapter, tickets and routes excluded |
| v2/control/workspaces, sharing and experimental APIs | Broad Server/AppRuntime/bootstrap imports | Many smaller JS/service dependencies | Narrow composition, retain real Bot handlers |
| UI/mDNS/Console/upgrade | Broad server/middleware/config eager imports | Smaller code, distinct network/lifecycle paths | Removed; fewer entrypoints and cleanup paths |

Metafile inputs decrease from 3,093 to 2,862; package/version inputs decrease from
355 to 341. These are bundle input counts, not claims that every parsed module
contributes emitted JS. Fourteen package/version inputs disappear: FFF bin/bun,
TypeScript, bun-pty, Bonjour, multicast-dns, dns-packet, ip-codec, thunky, acorn,
buffer-from, source-map, source-map-support and the FFF-only ignore version. Full
upstream frozen build dependencies remain available for independent compatibility
and SDK generation; they are not installed in the released compiled runtime.
[Machine-readable measurements](validation/slimming-measurements.json) include all
removed inputs and package versions. Bun metafiles do not measure engine RSS or
sum directly to executable bytes.

## Remaining process surface and removed gates

| Process/lifecycle class | Production disposition |
| --- | --- |
| Manual/model shell and governed custom-tool invocation | Required; captured immutable run/phase, admission, cancellation, bounded joined group cleanup |
| MCP stdio | Required; workspace service identity, SDK protocol and shared service-group retirement |
| LSP server/installers | Required; captured workspace acquisition, cancellation, registered groups and bounded joined cleanup |
| Git/ripgrep/npm/truncation/download/helper work | Required by retained tools/config/services; governed utility/helper paths |
| Provider HTTP/SSE and remote MCP/OAuth | Required logical request/transport lifetimes, not OS daemons |
| Persistent Playwright/custom daemon work | Required external Bot-tool feature; ownership integration remains open |
| PTY, OS OAuth browser opener, mDNS, FFF native index, upgrade/share/proxy/UI processes/services | Production unreachable; excluded, no stable gate |
| Bot Tailscale/SSH | Bot-owned; no migration/change in this Core task |

PTY adapter/group teardown and the 500ms open-URL launcher pseudo-ownership defects
are removed from Core production gates. Generic upstream daemons/CLI/frontend paths
are not stabilized for parity. Required LSP/MCP/shell/helpers still use shared
service/group retirement primitives. Uncertain cleanup retains authority and
admission; no deadline or release condition was weakened.

Genuine remaining blockers:

1. Bot custom tools still use raw `node:child_process.execFile`; persistent browser
   session/daemon ownership cannot be inferred from a short-lived governed launcher.
   Core's invocation capability exists, but current tools have not adopted it.
   This task preserves browser capability and performs no Bot migration.
2. Remote MCP/OAuth pending transport/callback ownership is not yet consolidated
   under workspace closing/retirement. Module-level pending OAuth state and remote
   acquisition need isolation, late-publication/replacement/cleanup tests and fixes.
3. Actual hard-crash containment/reaping and restart safety for all remaining
   process classes require fault-injection evidence, beyond ordinary joined cleanup
   or an init process. Required provider credential/plugin helper subprocesses also
   need the final spawner/ownership audit.
4. Broad workload/long-soak coverage, operator rollback and RC soak remain necessary
   for stable. A short actual-runtime Railway soak is evidence, not closure of these
   gates or proof of leak freedom.

## Validation and resource evidence

Commands are repeatable: `test-native-runtime.sh`, `test-upstream-runtime.sh`,
`build-runtime.sh`, `test-headless-runtime.sh`, `build-sdk.sh`, independent
`build-compat-cli.sh`, `run-compatibility.sh`, `package-release.sh`, `verify-release.sh`.
The exact final commit, CI run, Railway deployment, checksums and artifact sizes are
attached to the single PR and prerelease manifest after final verification.

Current local gates: native typecheck/299 tests; full shared upstream typecheck/SDK
surface/324 tests + 2 expected skips; ten npm/config tests; all five original shell
cancellation repeats. The production composition separately exercises 313 supported
upstream tests, two expected skips, the same cancellation repeats, ripgrep/filesystem
and npm/config tests. Eleven compatibility-only assertions (browser helper, future
live-control APIs, experimental route and sync schema export) run against the full
shared composition, not the production tree. Required compiled regressions cover
positive/negative routes, authentication, model+shell/history, real SSE provenance,
abort/group cleanup, actual MCP stdio descendants, captured custom-tool execution with offline dependency preparation, and workspace disposal.
Independent compiled compatibility tests retain v2 durable history/cursors/SSE and
physical live pause/resume/abort/stale fencing under explicit Telegram admission.

Initial local service cleanup tests failed because this workspace's PID 1 is `tail`
and did not reap killed orphan children. They passed with a child-reaping subreaper;
production group-death assertions and five-second cleanup were unchanged. The
Railway validation image uses tini. The new debug physical pause fixture initially
omitted the governor flag (the full CLI does not force Telegram admission); the
corrected fixture explicitly enables that policy and observes SIGSTOP within the
existing Linux test bound. No production change or rerun-until-green workaround. The custom-tool fixture initially blocked on direct external registry access in the isolated Cloud environment; a local deterministic registry now exercises real dependency preparation without that external dependency.

Local six-cycle model/shell/dispose measurements: idle RSS 270,932→242,456 KiB;
observed peak RSS 775,768→689,596 KiB; startup 1.320→1.321 seconds. Final thread
samples 11→9. These are short `/proc` RSS/allocator samples, not cgroup working-set
measurements or stable memory/leak claims. Post-dispose RSS still grows during warmup,
which must be assessed under longer representative loads. The actual compiled
Railway image runs production regression tests, retains a live compiled server,
repeats real two-session model/shell/history/abort/dispose workloads, and exposes only
its validation evidence endpoint; Core APIs stay loopback-only. Native smoke alone
is not accepted as runtime validation.

## Recalculated readiness and shortest release path

These percentages are transparent checklist coverage, not probabilities or parity
scores. Removing unused features reduces the denominator; no unsupported feature is
required for release.

- Architecture: **80% (8/10)** — consumer scope, narrow composition, references/
  plugins, auth/directory isolation, agent/tool stack, native routing/scheduling,
  fencing/governor and reproducible release composition defined; complete shared
  persistent ownership and hard-crash containment architecture remain.
- Implementation: **75% (9/12)** — audited scope/graph removal, fail-closed APIs,
  supported inference/tools, native isolation/scheduling/rendering, shell/custom
  invocation governance, LSP acquisition/group ownership, MCP local ownership,
  helper cancellation and aligned release tooling implemented; persistent browser,
  remote MCP/OAuth retirement and hard-crash containment remain.
- RC-ready: **75% (9/12)** once the exact candidate cumulative CI/artifact/Railway
  gates pass — the nine implemented obligations above are verified; the three
  genuine required ownership/containment obligations remain blockers.
- Stable-ready: **56.25% (9/16)** — the same nine verified obligations; the three
  remaining ownership obligations plus broad workload stress, long resource soak,
  operator rollback/recovery verification and verified RC soak remain.

Shortest path to rc.1: close the three required ownership/containment obligations
with one shared lifecycle model and deterministic regressions; repeat the cumulative
supported-process Linux stress and actual compiled Railway fault/resource gate;
produce aligned identity/checksum artifacts from that exact green commit. No PTY,
OS OAuth opener, frontend, interactive CLI or full-backend parity work belongs here.
Bot custom-process adoption, if needed to close the integration boundary, requires
its own explicitly authorized migration phase and is not performed by this PR.

Shortest path rc.1→stable: broaden the RC workload matrix (single/concurrent/fan-out,
MCP/LSP/tool/shell, event/render/poll/scheduled, restart/failure); demonstrate bounded
resource trends and confirmed cleanup/rollback over an agreed soak window; keep all
prior invariants green; publish stable from the exact verified RC-derived commit.
No RC or stable label is justified by this slimming prerelease alone.
