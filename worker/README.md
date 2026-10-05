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
retained. Core configuration and tools are root-owned; session data and the
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
