# Topic Worker agent

The Topic Worker is the per-Topic runtime boundary used by the Bot Control Plane. Its purpose is to run one Telegram Topic's OpenCode server and workspace behind a narrow authenticated RPC surface. It does not poll Telegram or provision Railway resources.

## Responsibilities

| Component | Responsibility |
|---|---|
| Dockerfile.worker | Builds the pinned OpenCode Telegram Core runtime and Python Worker agent |
| node_agent.py | Starts the root-owned agent, exposes health/RPC, validates requests, and coordinates Core lifecycle |
| bootstrap_identity.py and cloud_bootstrap.py | Install the identity, generation, signing material, and initial configuration provided by the Control Plane |
| control_bridge.py | Calls the Bot Control Plane for narrowly scoped operations and credentials |
| credential_broker.py and credential_transport.py | Acquire purpose- and capability-bound credential leases when a supported request needs them |
| provider_proxy.py, github_proxy.py, mcp_proxy.py | Forward supported provider/GitHub/MCP traffic without persisting plaintext credentials in Core config |
| action_runtime.py and runtime_tools/ | Resolve enabled generated actions, provide governed browser/network helpers, and expose read-only Topic runtime introspection |
| single_slot.py | Enforce one-Topic-at-a-time state and safe retirement/reuse |
| git_shim.py, tailscale_remote.py, tailscale_runtime.py | Provide constrained Git and optional network/runtime integration bridges |

## Trust boundaries

- The Bot Control Plane provisions the dedicated /data volume, Worker identity, generation, and per-node signing key. Railway provisioning credentials remain in the Control Plane.
- The Worker does not receive TELEGRAM_BOT_TOKEN or RAILWAY_API_TOKEN.
- The agent runs as root to own configuration, identity, and lifecycle supervision. OpenCode Core runs as UID 1000 on loopback; Topic session/workspace data remains owned by that runtime user.
- Public HTTP exposes readiness and authenticated RPC only. The raw OpenCode API is not public.
- NODE_SHARED_SECRET is captured before Core starts and removed from Core's environment.
- Package/build caches live in /tmp; durable Topic data lives on the dedicated volume.

## RPC and event flow

RPC signs the exact UTF-8 request envelope with HMAC-SHA256. The signed fields bind node, generation, Telegram chat/thread, session, operation, timestamp, and nonce. Replay admission is stored in root-owned SQLite. Public request concurrency is bounded before request body reads; header parsing has a finite timeout.

Streaming is available only for a prepared, active run. Signed event frames are filtered to the bound session and run provenance. The Worker returns a separate signed stream-ready acknowledgment before the Control Plane dispatches the prompt, so a successfully created session is not confused with an active delivery path.

## Snapshot, credentials, and generated actions

Global snapshots use canonical JSON hashes and verified Skill hashes. They are staged immutably, checked against per-materialization disk limits, and activated atomically. Only active and rollback artifacts are retained. Interrupted staging is reclaimed before retry. A failed activation may restore only the exact previously known-good hash; a corrupt active cache is not evidence that an older revision is safe.

Snapshots contain credential references rather than plaintext credentials. Provider and remote MCP proxies lease secrets only for an admitted, bound operation and keep them in memory for a bounded time. Core configuration, process environment, logs, and model prompts must not receive lease values. Remote MCP uses the fixed Streamable HTTP boundary described below; unsupported OAuth/SSE negotiation fails closed.

Generated action discovery resolves exact enabled snapshot records and immutable arguments. Execution uses the resolved native, action, or MCP tool inside the current Core permission/process context. The bridge does not expose a generic remote tool-execution endpoint, and a model cannot mint a Telegram approval.

## Runtime introspection tool

The image-owned `runtime` custom tool provides three read-only actions. `capabilities` queries the live OpenCode tool registry (including dynamic MCP tools) and, when the captured assistant message identifies a model, asks the pinned model-specific registry for that model's available tools. It returns tool IDs and bounded descriptions, never parameter schemas or secrets. If model resolution is unavailable, it falls back to the exact live tool-ID list rather than guessing from filenames. The routes are verified against the pinned upstream implementation at [OpenCode commit `51ef4be`](https://github.com/anomalyco/opencode/blob/51ef4be1d3c122f18fefb510dca8d778571f4f18/packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts).

`diagnostics` reports this Topic's readiness, Core process liveness/available RSS, uptime, snapshot revision/integrity, and whether the supported GitHub/Tailscale integrations are configured. `verify` checks the bound Topic, Core process/readiness, snapshot integrity and activation against the current revision/hash, expected generated tool files (including stale optional integration files), and the loopback Core health endpoint. It does not run shell commands, tests, or mutations. None of the actions returns prompts, environment variables, credential values, arbitrary process output, or filesystem paths. Requests go through the existing loopback ControlBridge and must carry the exact captured session ID; the bridge fails closed for unbound or retired Workers.

## One Topic per Worker and lifecycle

A Worker owns one slot. chatId=0 and threadId=0 mean ready-unbound: the root agent is alive and the slot may accept one new Topic. Session/model execution remains unavailable until a bound Core reports authenticated ready. Railway GET /health reports agent liveness and deliberately does not claim Core/model readiness.

Delete Chat moves the slot to RETIRING, joins Core and owned processes/streams, sanitizes Topic/session/workspace state, and rotates to the exact next generation with new signing material. Only proven clean state becomes ready-unbound. A clean unbound generation can fence itself before accepting the next Topic; traffic from every prior generation remains rejected. Uncertain Core, callback, listener, credential-proxy, or descendant cleanup prevents reuse and retires the container.

The Bot allocator may select another Worker when a slot is unavailable. The Worker never makes a capacity claim based on its liveness check alone.

## Remote MCP credential boundary

Remote MCP URLs are rewritten to a root-agent loopback proxy. During an admitted owned run, the proxy requests credential.get with purpose mcp.request, the exact mcp:<name> capability, a snapshot credential reference, original HTTPS endpoint, and bound session. Leased headers stay in Agent memory for at most 60 seconds. Uncredentialed servers use the same endpoint boundary without a lease.

The proxy supports Streamable HTTP POST/GET/DELETE and preserves MCP session/protocol headers. Public DNS addresses are pinned with verified TLS, redirects are refused, requests are bounded to 10 MiB, and responses to 32 MiB. Active streams close on completion, stop, reload, or retirement. There is no idle reconnect or credential refresh; a stream exceeding ten minutes closes its capability connection without stopping the Core execution.

Legacy SSE negotiation and OAuth client acquisition are unsupported and fail closed. A safely leased access token may authenticate a Streamable HTTP server while Core OAuth remains disabled for the local proxy route.

## Tests and operational references

The compiled integration probe is tests/worker/compiled_agent.py. It exercises real model/shell execution, signed events, Question replies, execution control, process joining, and persistent restart recovery. Python unit tests are included in root unittest discovery through tests/test_worker.py. Run the root verification commands in ../README.md; a Worker /health response alone is not an end-to-end readiness check.

The Bot owns Railway project/service/volume provisioning and capacity policy. The Worker owns one provisioned slot's runtime boundary. See the root Core README, docs/RAILWAY_CONTAINMENT_BOUNDARY.md, and docs/WORKER_RUNTIME_PARITY.md for the related contracts and current release status.
