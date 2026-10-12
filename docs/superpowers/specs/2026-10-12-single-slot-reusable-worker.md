# Single-Slot Reusable Railway Worker

## Intent

Optimize OpenCode Telegram Core for the production invariant that one Railway Worker can own at most one Telegram Topic at a time. A Worker may be reused only after `Delete Chat` fully retires the previous Topic and returns the Worker to a clean `ready-unbound` state.

Primary goals:

- remove multi-Topic isolation machinery that no longer provides value inside a dedicated Worker;
- minimize Core cold-start and hot-path overhead;
- make Railway health succeed as soon as the Worker agent is alive, without falsely claiming model readiness;
- preserve hard cleanup and stale-request fencing across Topic reuse;
- reduce Worker image/build cost without removing required model/tool capabilities.

## Production invariant

A Worker has exactly one slot and exactly one lifecycle state:

`UNBOUND -> BINDING -> WARMING -> READY -> RUNNING -> RETIRING -> UNBOUND`

No state permits two Topic identities or two concurrent Topic owners. A Topic identity consists of chat/thread/session ownership plus a monotonically increasing slot generation.

`Delete Chat` is the only normal transition that makes a bound Worker reusable. Reuse is forbidden until the previous Core process, active run, external tool processes, session state, credentials, streams, and Topic workspace have been retired or the Worker has been destroyed.

## What remains fenced

Multi-binding registries are removed, but one boundary fence remains mandatory: `slotGeneration`.

Every Control -> Worker RPC, stream, continuation, cancellation, and readiness acknowledgment is bound to the current slot generation. When the Worker returns to `UNBOUND`, generation advances before a new Topic can bind. Any packet, callback, stream frame, or continuation from an older generation is rejected.

This generation is a stale-request fence, not a multi-Topic scheduling primitive.

## Runtime simplification

The dedicated Worker runtime does not need an internal pool of Topic workers. The following concepts should be removed from the production single-slot path where they are used only to multiplex multiple Topic bindings:

- multi-record `BindingRegistry` ownership;
- `AtomicBindingStore` as a multi-binding durable store and its per-binding tombstones;
- `WorkerSupervisor` capacity, LRU eviction, pending creation map, retirement capacity accounting, and per-binding worker generations;
- repeated `sameBinding()` checks inside the prompt hot path once ingress has validated the active slot generation;
- per-Topic in-process worker creation/replacement lifecycle;
- isolation poisoning whose purpose is to protect unrelated Topics in the same process.

Safety mechanisms that protect the single Topic itself remain:

- one active execution lease;
- abort/cancel propagation;
- prompt/task deadline and stuck detection where it prevents indefinite hangs;
- process-group ownership and descendant cleanup for shell/LSP/MCP/browser/custom tools;
- provider/MCP/Git/Tailscale credential boundaries;
- temporary-session cleanup;
- stale generation checks at the authenticated Worker boundary;
- fail-closed behavior when retirement cannot prove cleanup.

## Single-slot runtime

Introduce a small `SingleSlotRuntime`/equivalent owner with these responsibilities only:

- current state;
- current Topic identity, if bound;
- current `slotGeneration`;
- current Core process lease;
- current active run lease;
- transition serialization;
- retirement proof.

The runtime must not contain a collection of Topic workers. It may own only one Core execution context.

The hot prompt path after authenticated ingress should be approximately:

`RPC generation check -> active-run lease -> OpenCode prompt -> event stream`

No durable binding-store writes or supervisor lookups occur per prompt/chunk.

## Rebind and Delete Chat

`Delete Chat` executes a strict retirement sequence:

1. atomically move state to `RETIRING` and reject new execution;
2. cancel/abort the active run and close event streams;
3. dispose Core and join the Core process;
4. close provider, MCP, Git, Tailscale and browser/tool capabilities;
5. prove descendant process cleanup;
6. delete Topic/session/workspace state owned by the old generation;
7. rotate the slot generation and node signing material required by the Control protocol;
8. persist the clean unbound identity/state;
9. move to `UNBOUND` and advertise `ready-unbound`.

If any step cannot prove cleanup, the Worker must not become reusable. The safe outcome is process/container retirement and replacement.

## Health and readiness

Railway liveness and model readiness are separate signals.

### `/health`

`/health` is the Railway deployment health endpoint. It returns HTTP 200 when the root Worker agent is alive and able to accept authenticated control operations. It does not wait for Core/model readiness.

This keeps Railway activation fast and avoids repeated deployment-health retries while Core is warming.

### Worker readiness

Control Plane uses authenticated Worker state, not `/health`, before routing a model prompt.

Worker readiness states include at minimum:

- `ready-unbound`: agent is healthy and can accept a Topic bind;
- `warming`: Topic is bound and Core is starting/preparing;
- `ready`: Core is verified ready for model traffic;
- `running`: active execution exists;
- `retiring`: no new work allowed.

A prompt is admitted only in the current generation and only from `ready`/the valid continuation state.

## Faster Core startup

The current fixed 100 x 100 ms health probe loop is replaced by bounded fast readiness detection:

- first probe immediately after spawn;
- short adaptive backoff rather than a fixed 100 ms sleep after every failure;
- terminate immediately on Core process exit;
- keep a strict startup deadline;
- publish measured startup latency.

Where possible, Core should emit or expose a deterministic local readiness signal so the Agent does not need unnecessary polling.

Binding/New Chat should start Core warming immediately. The user composing the first Telegram message then overlaps with Core startup.

## Build and image strategy

Worker creation must consume an immutable prebuilt Worker image. Creating a new Telegram Topic must never compile Core.

The Docker build will be audited for weight and layer invalidation. Optimization priorities:

1. maximize cache stability around pinned Core/upstream artifacts;
2. avoid reinstalling unchanged system/runtime dependencies when only Core source changes;
3. remove packages not required in the production Worker image;
4. separate or lazily provision very large optional tooling where this does not break expected model capabilities;
5. avoid runtime package managers or bootstrap work on container start;
6. retain production debugging/tooling only when it is actually model-visible or required by supported integrations.

Chromium/Playwright, native build tools, ffmpeg/ImageMagick, Tailscale and development utilities must each be justified by a supported capability before removal. Image slimming must not silently cripple the model.

## Performance measurement

Before/after measurements are required for:

- Worker image size;
- Docker build duration with cold and warm cache when available;
- container start -> `/health` 200;
- container start -> `ready-unbound`;
- bind -> Core `ready`;
- prompt admission overhead before provider network time;
- idle RSS and bound-ready RSS;
- Delete Chat -> reusable `ready-unbound` latency.

The optimization is complete only when tests pass and Railway runtime logs confirm the intended lifecycle.

## Compatibility boundary

Control Plane remains orchestration-only and Core-free. Core/OpenCode execution exists only in Worker services.

The Control protocol may preserve existing field names during migration, but production semantics become single-slot. Backward compatibility code that exists only for the retired multi-Topic-in-one-runtime model should be removed after Bot and Worker are aligned.

## Test requirements

The change requires regression coverage for:

- second Topic cannot bind while one is active;
- stale-generation RPC/stream/cancel is rejected after reuse;
- Delete Chat fully retires active execution and descendants;
- clean Worker returns to `ready-unbound` and accepts a new Topic;
- failed cleanup never returns to reusable state;
- Railway `/health` succeeds before Core readiness without admitting prompts early;
- Core readiness transition is deterministic and bounded;
- no prompt hot-path dependency on multi-binding store/supervisor remains;
- existing shell/MCP/browser/process cleanup guarantees remain intact.

## Rollout

Implement in narrow verified stages:

1. add lifecycle/readiness tests and timing instrumentation;
2. separate Railway liveness from Core readiness;
3. introduce single-slot ownership and migrate Worker RPC lifecycle;
4. remove multi-binding/supervisor hot-path machinery;
5. simplify Delete Chat rebind cleanup around slot generation;
6. optimize image/build layers and optional tooling;
7. align Bot/Control protocol and immutable Worker image;
8. run full Core/Bot suites and Railway end-to-end qualification;
9. compare measured latency/resource/build results and perform a final code/ownership audit.
