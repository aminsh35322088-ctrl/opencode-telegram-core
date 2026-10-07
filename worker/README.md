# Topic Worker agent

`Dockerfile.worker` builds the pinned compiled Core and runs a root-owned Python
agent. Core runs as UID 1000 on loopback. Public access is limited to `/health`
and authenticated `/rpc`; the raw Core API is never public.

The Bot control plane provisions the dedicated `/data` volume, identity,
generation and per-node signing key. `NODE_SHARED_SECRET` is captured before
Core starts and is excluded from its environment. No Railway provisioning
credential belongs in this service.

RPC signs exact UTF-8 envelope bytes with HMAC-SHA256. Envelopes bind node,
generation, Telegram chat/thread, session, operation, timestamp and nonce.
Replay admission persists in root-owned SQLite. Streaming exists only for an
active prepared run and includes signed, session-filtered event frames. Stream
readiness uses a separate signed acknowledgment before prompt dispatch.

Global snapshots use canonical JSON hashes, verified Skill hashes, immutable
staging and atomic activation. Only current and rollback artifact versions are
retained. Each materialization admits at most 32 MiB including filesystem block
overhead and reserves 16 MiB free disk; interrupted staging is reclaimed before
a retry. Verified revision fencing is separate from known-good activation proof:
a failed Core activation may restore only the exact prior known-good hash, while
corrupt active caches cannot restore an older successfully activated revision.
Public request admission is capped at eight threads before header/body reads,
with a 15-second header timeout. Core configuration and tools are root-owned; session data and the
Topic workspace remain UID 1000-owned. Package and build caches use `/tmp`.
Snapshots contain credential references, never plaintext credentials.

The provider proxy leases credentials on demand and inserts them into fixed
authorized HTTPS provider requests in memory. The local model tool bridge can
prepare or commit an exact global mutation through the control plane; it cannot
issue a Telegram approval receipt. No idle outbound heartbeat or polling loop
is installed.

The compiled integration probe is `tests/worker/compiled_agent.py`. It verifies
real model/shell execution, signed events, Question replies, pause/resume,
joining stopped shell processes and persistent restart recovery. Unit tests are
included in the existing root unittest discovery through `tests/test_worker.py`.

This prerelease supplies the Worker boundary. Production readiness also requires
the Bot's authenticated control endpoint, allocator, catalog, credential leases,
Telegram routing and end-to-end Railway tests. Secure remote MCP credential
materialization and the complete generated Action execution path require that
control-plane integration; stored metadata alone is not proof of execution.
# Remote MCP credential boundary

Remote MCP URLs are rewritten to a root Agent loopback proxy. During an admitted
owned run, the proxy requests `credential.get` with purpose `mcp.request`, exact
`mcp:<name>` capability, snapshot credential reference ID, original HTTPS endpoint,
and bound session. Leased headers remain in Agent memory for at most 60 seconds;
Core configuration, process environment and logs receive no credential values.
Uncredentialed remote servers use the same endpoint boundary without a lease.

The proxy supports Streamable HTTP POST/GET/DELETE and preserves MCP session and
protocol headers. Public DNS addresses are pinned with verified TLS, redirects
are refused, requests are bounded to 10 MiB and responses to 32 MiB. Active
streams are closed on execution completion, stop, reload or retirement; there is
no idle reconnect or credential refresh. A stream exceeding ten minutes closes
that capability connection, without stopping the Core execution.

Legacy SSE endpoint negotiation and OAuth client acquisition are unsupported and
fail closed. An existing safely leased access token may authenticate a Streamable
HTTP server; Core is configured with OAuth disabled for its local proxy route.
The compiled MCP probe uses an offline synthetic upstream transport; it verifies
real Core discovery and tool execution, while DNS/TLS rejection is unit-tested.

Pending credential and TCP/TLS requests are cancellable without holding the runtime retirement lock. Unsupported remote transport configuration marks only that runtime capability unavailable; it does not block ordinary Topic AI or alter canonical Global enabled settings.

## Unbound cluster slots

A slot with `chatId=0` and `threadId=0` is explicitly unbound. It may bootstrap a
verified Global snapshot and serve authenticated health/status/sync/retire only.
Its Core workspace, data and state remain ephemeral; session, model, tool,
credential and mutation admission fail closed. Privileged provisioning credential
names in its environment reject startup before any child is launched.

To claim a slot, Control must first durably fence its old identity, authenticate
retirement and confirm its essential Core joined successfully, then redeploy on
the serialized dedicated volume with the same node ID, exact next generation,
rotated node key and valid Topic ownership. The durable ledger requires retirement
proof and no session/execution/Topic files, then atomically activates the identity.
An already bound volume cannot be rebound through this transition.

Generated action discovery resolves exact enabled snapshot records and immutable
fixed arguments through the materialized `actions` tool. Execution uses the
resolved native/action/MCP tool in the active Core permission/process context;
the bridge does not expose a generic tool-execution endpoint.
