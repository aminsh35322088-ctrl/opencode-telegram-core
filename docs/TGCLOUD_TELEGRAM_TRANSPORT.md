# TGCloud Telegram Transport and Multi-Topic Node

## Status

Design note for the TGCloud migration. The current TGCloud handler implements
only discovery/registration (hello and heartbeat) and keeps every new Node in
pending. It is not yet compatible with the Core Worker's signed HTTP RPC
contract. Do not enable execution through the discovery protocol.

## Goals

- TGCloud is the only control plane; no Railway Worker pool and no separate
  always-on bridge service.
- The primary Telegram bot remains owned by TGCloud's managed webhook.
- Each physical Node owns one dedicated Worker Bot token and exactly one
  long-polling consumer for that token.
- A Node may host multiple isolated Topic Workers.
- The existing Core identity and execution fences remain authoritative:
  nodeId, generation, chatId, threadId, sessionId, binding generation,
  run ID, and workspace identity must never be inferred or weakened.
- No automatic Topic reassignment when a Node becomes unreachable.

## Transport topology

1. Telegram delivers user updates to the primary bot's TGCloud webhook.
2. TGCloud validates the update and resolves the exact topic binding.
3. TGCloud sends a signed command to the Worker Bot private chat.
4. The Node's single poller receives the command and routes it to the correct
   Topic Worker by exact identity.
5. The Topic Worker executes through the existing Core Agent/RPC boundary.
6. The Node returns a signed result/event through its Worker Bot.
7. TGCloud persists the result and performs user-facing Telegram delivery.

The primary bot token is never placed on a Node. A Worker Bot token is scoped
to one physical Node and must not be shared by independent Nodes. A Worker
token must not have a webhook while the Node is polling with getUpdates.

## Signed envelope adaptation

The Core Worker currently signs canonical JSON with HMAC-SHA256. The Telegram
transport must preserve the exact bytes covered by the signature. The message
wrapper therefore carries a base64-encoded canonical envelope plus its
hex-encoded HMAC signature; wrapper metadata is not part of the signed body.

The signed envelope retains the existing Core fields:
- version
- nodeId
- generation
- chatId
- threadId
- sessionId when bound
- operation
- payload
- timestamp
- nonce

Transport metadata distinguishes request, response, command, and command
result. Responses correlate to the original nonce and operation. HMAC
verification, timestamp validation, identity fencing, and durable nonce replay
admission remain mandatory.

## Bootstrap and key ownership

- Initial discovery is authenticated by possession of the dedicated Worker
  Bot token and Telegram's sender bot ID.
- TGCloud issues a per-Node random signing secret once the Worker Bot identity
  is bound to a Node ID. The secret is delivered only to that Worker Bot's
  private chat and is persisted in TGCloud's Node record.
- The Node stores the secret in its root-owned durable agent state. It is
  never passed to the unprivileged Core/model process or logged.
- Re-bootstrap and key rotation must be explicit, generation-fenced operations.
  A Telegram message alone must never silently reset an existing Node identity.

## One Node, multiple Topics

The current Worker implementation is intentionally one Topic per
SingleSlotRuntime. Preserve that isolation boundary, but introduce a
Node-level supervisor that owns:
- one Telegram long-polling loop per Worker Bot token;
- a durable registry of Topic Worker slots;
- one isolated Worker Agent/Core lifecycle per admitted Topic slot;
- routing from signed Telegram envelopes to the exact slot identity;
- bounded per-Node slot admission based on measured memory/CPU capacity;
- joined retirement and generation rotation before a slot is reused.

A slot is not reusable until Core, child processes, callbacks, streams, and
workspace cleanup are proven complete. A lost Node does not authorize a slot
to be reassigned elsewhere.

## Telegram transport constraints

- Telegram allows webhook delivery or getUpdates for a bot token, not both.
  The primary token stays on TGCloud webhook; each Worker token is polled by
  exactly one Node process.
- Private bot-to-bot communication must be enabled for both bots.
- A text message is limited to 4096 characters. Large snapshots/results need
  bounded document transfer or independently authenticated chunks with
  sequence numbers, total size, content hash, and strict reassembly limits.
- getUpdates retains updates for no more than 24 hours. Node restart/recovery
  must reconcile durable request IDs and never assume an expired update is
  still available.
- The poller must deduplicate updates, bound per-bot request rates, and prevent
  message loops. A duplicate must replay the previously stored response, not
  execute a command twice.

## Implementation phases

1. Discovery (done in TGCloud prototype): bind sender bot ID to a pending
   Node record; record inbound Telegram update IDs; acknowledge hello.
2. Signed transport: HMAC bootstrap, request/response correlation, replay
   ledger, durable offset/response handling, bounded message/document framing.
3. Node supervisor: one poller, multiple isolated Topic Worker slots,
   resource admission, exact identity routing, retirement and recovery tests.
4. Control-plane operations: binding create/rotate/delete, heartbeat health,
   durable command queue, ACK/result handling, snapshots and credential leases.
5. End-to-end validation: two Nodes, multiple Topics per Node, simultaneous
   runs, restart/replay, lost Node, stale generation, Telegram rate limiting,
   and long-soak tests.

## Explicit non-goals

- No Telegram getUpdates call for the primary bot.
- No public unauthenticated Node HTTP API.
- No shared Worker Bot token across physical Nodes.
- No Telegram bridge service separate from TGCloud and the Node.
- No weakening of Core HMAC, replay, session, binding-generation, or run fences.
