# Single-Slot Reusable Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Railway Worker/Core path to one reusable single-Topic slot with fast Railway liveness, bounded Core readiness, minimal prompt-path isolation overhead, and measured build/runtime improvements.

**Architecture:** The root Python Worker agent owns exactly one slot and one Core child. Railway `/health` proves only that the root agent can accept control traffic; authenticated slot status proves whether Core is `warming`, `ready`, `running`, or `retiring`. Reuse after `Delete Chat` requires fail-closed retirement, state/workspace cleanup, and monotonically increasing slot generation before a new Topic can bind.

**Tech Stack:** Python 3 Worker agent/tests, TypeScript/Bun native runtime, compiled OpenCode headless binary, Docker/BuildKit, Railway, Node 22, GitHub Container Registry.

**Spec:** `docs/superpowers/specs/2026-10-12-single-slot-reusable-worker.md`

## Global Constraints

- One Railway Worker owns at most one Telegram Topic at a time.
- A Worker becomes reusable only after `Delete Chat` proves full retirement and reaches `ready-unbound`.
- Stale generation RPC, stream, continuation and cancellation traffic must fail closed.
- Control Plane remains orchestration-only and Core-free.
- `/health` must not wait for Core/model readiness.
- Prompt admission requires authenticated current-generation readiness, never Railway liveness alone.
- Shell/LSP/MCP/browser/custom-tool process ownership and descendant cleanup remain enforced.
- Worker creation consumes an immutable prebuilt image; Topic creation never compiles Core.
- Performance changes require before/after measurements and Railway runtime evidence.

## Review Focus

- A delayed packet from the previous Topic generation after reuse must be rejected before Core access.
- `Delete Chat` during an active model/tool run must not expose `ready-unbound` until Core and descendants are joined or the container retires.
- `/health` must return 200 while Core is still warming, but prompt/run RPC must remain rejected until authenticated readiness is `ready`.
- A failed cleanup, failed Core dispose, or ambiguous listener/process shutdown must never produce a reusable slot.
- Optional heavy capabilities (browser, Tailscale, native build tools, media tooling) must not disappear from the advertised model surface merely to improve image metrics.

---

## File Structure

Core repository responsibilities:

- `worker/single_slot.py` — single-slot lifecycle, generation and active-run admission; no transport or Core HTTP logic.
- `worker/node_agent.py` — authenticated RPC, Core child ownership, snapshot/config materialization, readiness, retirement and HTTP health surface.
- `tests/worker/test_single_slot.py` — pure state-machine and stale-generation tests.
- `tests/worker/test_node_agent.py` — agent readiness, Core startup, health and fail-closed retirement integration.
- `tests/worker/test_binding_rotation.py` — clean bound↔unbound reuse and listener/key rotation.
- `runtime/src/**` — legacy native multi-binding surface; prune only after consumer audit proves production does not depend on it.
- `Dockerfile.worker`, `scripts/build-runtime.sh`, `scripts/common.sh` — build cache/image optimizations without capability regression.
- `validation/slimming-measurements.json` — measured before/after evidence.

Bot repository responsibilities after Core compatibility is proven:

- Worker allocator/control RPC code — consume explicit single-slot readiness and reuse an unbound Worker only after generation rotation.
- Worker image pin — move to the newly qualified immutable digest.
- Delete Chat path — require retirement proof before returning Worker capacity.

---

### Task 1: Pin Baselines and Separate Railway Liveness From Core Readiness

**Files:**
- Modify: `worker/node_agent.py`
- Modify: `tests/worker/test_node_agent.py`
- Create/Modify: `validation/slimming-measurements.json`

**Interfaces:**
- Produces: `Agent.readiness_state() -> str` returning one of `ready-unbound|warming|ready|running|retiring`.
- Produces: public `GET /health` = HTTP 200 when the root Agent HTTP server is alive and not fatally retired, independent of Core readiness.
- Produces: startup timing fields recorded by the agent for container→health and Core-spawn→ready measurements.

- [ ] **Step 1: Capture pre-change metrics**

Run the existing Worker image/build/runtime probes and record image size where available, build duration, current `/health` timing, Core-ready timing, idle RSS, and bound-ready RSS in `validation/slimming-measurements.json` under a `before` object.

- [ ] **Step 2: Write failing health/readiness tests**

Add tests asserting: an alive Agent with `ready == False` serves public `/health` as 200; authenticated status reports `warming` or `ready-unbound`; run/prompt admission still rejects before Core readiness; fatal/retired Agent does not claim reusable readiness.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `python3 -m unittest tests.worker.test_node_agent -v`

Expected: new liveness/readiness assertions fail under the current `ready`-coupled `/health` behavior.

- [ ] **Step 4: Implement the minimal liveness/readiness split**

Add `Agent.readiness_state() -> str`; change only the public health handler and authenticated status payload needed to expose the split. Do not relax run/session admission.

- [ ] **Step 5: Verify GREEN and full Worker suite**

Run: `python3 -m unittest tests.worker.test_node_agent -v && python3 -m unittest tests.test_worker -v`

Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

Commit message: `feat(worker): separate Railway liveness from Core readiness`

---

### Task 2: Replace Fixed Core Startup Polling With Bounded Fast Readiness

**Files:**
- Modify: `worker/node_agent.py`
- Modify: `tests/worker/test_node_agent.py`

**Interfaces:**
- Produces: `Agent.wait_for_core_ready(process, *, deadline_s: float = 10.0) -> float` returning startup latency seconds.
- Consumes: Task 1 readiness states.

- [ ] **Step 1: Write failing startup tests**

Add deterministic tests with injected clock/sleep or a small helper seam asserting: first probe is immediate; process exit aborts immediately; retry delay begins below 100 ms and is bounded; total wait obeys the strict deadline; successful readiness records latency and transitions `warming -> ready`.

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.worker.test_node_agent.ProcessSupervisorTests -v`

Expected: FAIL because the current implementation hardcodes `100 x sleep(.1)` and exposes no bounded readiness helper/latency.

- [ ] **Step 3: Implement adaptive bounded readiness**

Replace the fixed loop with immediate probe plus short capped backoff, strict monotonic deadline, immediate child-exit detection, and measured latency. Keep `/global/health` as the local Core readiness authority until a more deterministic compiled signal is available.

- [ ] **Step 4: Verify GREEN and Worker suite**

Run: `python3 -m unittest tests.worker.test_node_agent -v && python3 -m unittest tests.test_worker -v`

Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

Commit message: `perf(worker): make Core readiness bounded and fast`

---

### Task 3: Introduce the Single-Slot Lifecycle and Generation Fence

**Files:**
- Create: `worker/single_slot.py`
- Create: `tests/worker/test_single_slot.py`
- Modify: `worker/node_agent.py`
- Modify: `tests/worker/test_node_agent.py`

**Interfaces:**
- Produces: `SlotState` values `UNBOUND|BINDING|WARMING|READY|RUNNING|RETIRING`.
- Produces: `SingleSlotRuntime(identity: dict)` with `state`, `generation`, `topic`, `active_run_id`.
- Produces: `assert_generation(generation: int) -> None`, `begin_binding(identity)`, `mark_warming()`, `mark_ready()`, `begin_run(run_id)`, `finish_run(run_id)`, `begin_retirement()`, `complete_retirement(next_generation)`.
- Consumes: Task 1 readiness projection and Task 2 Core-ready transition.

- [ ] **Step 1: Write pure failing lifecycle tests**

Cover legal state transitions, second Topic bind rejection, second concurrent run rejection, stale generation rejection, retirement blocking new work, and clean `RETIRING -> UNBOUND` generation advance.

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.worker.test_single_slot -v`

Expected: FAIL because `worker.single_slot` does not exist.

- [ ] **Step 3: Implement the minimal state machine**

Use one lock and one current owner; no collections/maps of Topics or worker slots. Generation must be monotonic and validation must be O(1).

- [ ] **Step 4: Integrate Agent readiness/run admission with the slot**

Keep existing signed Boundary identity as protocol compatibility, but make the slot the production lifecycle authority for readiness and one-active-run admission.

- [ ] **Step 5: Verify GREEN and Worker suite**

Run: `python3 -m unittest tests.worker.test_single_slot -v && python3 -m unittest tests.test_worker -v`

Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

Commit message: `refactor(worker): own execution with a single reusable slot`

---

### Task 4: Make Delete Chat Retirement Return a Proven Clean `ready-unbound` Slot

**Files:**
- Modify: `worker/node_agent.py`
- Modify: `worker/single_slot.py`
- Modify: `tests/worker/test_binding_rotation.py`
- Modify: `tests/worker/test_node_agent.py`
- Modify: `worker/README.md`

**Interfaces:**
- Produces: retirement proof only after active run/streams, Core child, proxies/integrations, descendants, Topic/session/workspace state are cleaned.
- Produces: a clean unbound replacement identity with strictly incremented generation and rotated signing material before reuse.
- Consumes: Task 3 `SingleSlotRuntime` retirement transitions.

- [ ] **Step 1: Write failing reuse/cleanup tests**

Add tests asserting: Delete Chat during active execution enters `RETIRING`; listener/process cleanup failure never returns reusable state; old signed RPC/stream/cancel is rejected after generation rotation; clean retirement returns `ready-unbound`; a new Topic can then bind in-place; second Topic cannot bind before retirement.

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest tests.worker.test_binding_rotation tests.worker.test_node_agent.UnboundTests -v`

Expected: new single-slot reuse/readiness assertions fail on the current retired-Agent replacement semantics.

- [ ] **Step 3: Implement strict retirement/reuse**

Preserve fail-closed Core join semantics and root-owned credential/proxy cleanup. Advance slot generation only after cleanup proof. Reuse the process/container only when cleanup is proven; otherwise request fatal container replacement.

- [ ] **Step 4: Verify GREEN and all Worker/process suites**

Run: `python3 -m unittest tests.test_worker -v`

Then run the existing compiled/process ownership qualification scripts used by the repository for shell/MCP/browser descendant cleanup.

Expected: all applicable checks PASS; skipped platform-only checks are named explicitly.

- [ ] **Step 5: Commit**

Commit message: `feat(worker): recycle deleted Topics into clean unbound slots`

---

### Task 5: Remove Multi-Topic Runtime Machinery From the Production Path

**Files:**
- Audit/Modify: `runtime/src/core.ts`
- Audit/Modify: `runtime/src/runtime/atomic-binding-store.ts`
- Audit/Modify: `runtime/src/runtime/binding-registry.ts`
- Audit/Modify: `runtime/src/runtime/worker-supervisor.ts`
- Audit/Modify: `runtime/src/opencode/topic-worker.ts`
- Audit/Modify: `runtime/src/opencode/session-event-router.ts`
- Audit/Modify: `runtime/src/telegram/rich-stream.ts`
- Audit/Modify: `runtime/src/scheduler/task-dispatcher.ts`
- Modify matching tests under `runtime/test/`
- Modify: `runtime/src/index.ts`

**Interfaces:**
- Produces: production runtime surface with no per-prompt durable binding-store write, worker-pool lookup, LRU eviction, or multi-Topic generation lookup.
- Preserves: renderer, run cancellation/deadline/stuck detection, temporary-session cleanup, process ownership and public APIs still consumed by Bot until Bot migration completes.

- [ ] **Step 1: Perform a consumer audit before deleting APIs**

Search Core and current Bot `main` for every exported symbol above. Record which symbols are production-consumed versus test/legacy-only in the task ledger. Do not delete a Bot-consumed symbol in this task; first route that consumer to the single-slot equivalent or preserve a compatibility shim off the Worker hot path.

- [ ] **Step 2: Write failing production-surface/hot-path tests**

Add assertions that the single-slot Worker prompt path does not instantiate/use `AtomicBindingStore` or `WorkerSupervisor`, while stale ingress generation, cancellation, temporary-session cleanup and stream ownership remain enforced.

- [ ] **Step 3: Verify RED**

Run the focused Bun tests for production surface/core/topic worker.

Expected: new assertions identify remaining legacy production-path dependencies.

- [ ] **Step 4: Remove or isolate legacy multi-Topic machinery**

Delete test-only/unused exports and modules where the consumer audit proves no production dependency. Where compatibility is still required, keep it outside the Worker production path and mark it for removal after Task 7 Bot alignment.

- [ ] **Step 5: Verify GREEN and full native runtime suite**

Run: `cd runtime && bun run check`

Expected: typecheck PASS and all Bun tests PASS.

- [ ] **Step 6: Commit**

Commit message: `refactor(runtime): remove multi-Topic isolation from Worker hot path`

---

### Task 6: Optimize Worker Build/Image Without Removing Supported Capabilities

**Files:**
- Modify: `Dockerfile.worker`
- Modify: `scripts/build-runtime.sh`
- Modify: `scripts/common.sh` only where cache/input ordering requires it
- Modify: `tests/worker/test_runtime_smoke_environment.py`
- Modify: `tests/test_worker_runtime_parity.py`
- Modify: `validation/slimming-measurements.json`

**Interfaces:**
- Produces: same model-visible capability inventory with better cache reuse and no container-start package/bootstrap work.
- Preserves: browser/Playwright, Git/Git-LFS, Tailscale, native build support, ffmpeg/ImageMagick unless tests and capability inventory prove a package is genuinely unused.

- [ ] **Step 1: Write failing Docker/runtime inventory tests for intended cache boundaries**

Pin that Topic creation uses an immutable image and does not invoke Core compilation; pin required tool inventory; add static assertions that frequently changing Core source does not invalidate heavyweight runtime-tool installation layers unnecessarily.

- [ ] **Step 2: Verify RED**

Run the relevant Worker runtime parity/smoke tests.

Expected: at least one new cache/layer assertion fails on the current Dockerfile ordering.

- [ ] **Step 3: Reorder/cache build layers**

Use stable dependency/tool layers before volatile Core source inputs, BuildKit cache mounts where supported, and remove only packages proven unused by inventory/tests. Keep all required capabilities.

- [ ] **Step 4: Build and measure cold/warm behavior**

Build `Dockerfile.worker` twice with the repository-supported BuildKit path, capture duration and final image size, and update the `after` metrics.

- [ ] **Step 5: Run runtime smoke/parity and compiled Core qualification**

Expected: required command inventory and model/tool smoke tests PASS.

- [ ] **Step 6: Commit**

Commit message: `perf(worker): reduce Core image rebuild and startup cost`

---

### Task 7: Align Bot Control Plane With Single-Slot Readiness and Reuse

**Files (Bot repository):**
- Modify the existing Railway Worker allocator/control-client modules discovered by code search.
- Modify Delete Chat/topic lifecycle handler discovered by code search.
- Modify Worker readiness/health tests.
- Modify immutable Worker image digest constant after Core image qualification.

**Interfaces:**
- Consumes: Worker states `ready-unbound|warming|ready|running|retiring` and current generation from Tasks 1-4.
- Produces: allocator only assigns `ready-unbound`; New Chat triggers bind/prewarm immediately; prompt routing waits for authenticated `ready`; Delete Chat returns capacity only after retirement proof.

- [ ] **Step 1: Write failing Bot lifecycle tests**

Cover: allocator refuses bound/warming/retiring slots; New Chat starts bind/prewarm; prompt waits for authenticated ready instead of `/health`; Delete Chat does not free capacity before proof; stale generation response is rejected.

- [ ] **Step 2: Verify RED with focused Bot tests**

Expected: failures show current Control logic still assumes the previous binding/health semantics.

- [ ] **Step 3: Implement protocol alignment and keep Control Core-free**

No Core SDK/process initialization may be added to Control Plane. Worker credentials/signing material remain Worker-scoped; Railway provisioning token remains Control-only.

- [ ] **Step 4: Verify GREEN and full Bot suite**

Run the repository's full Bot test/build commands.

Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

Commit message: `feat: align Railway control plane with reusable single-slot workers`

---

### Task 8: Publish Immutable Worker Image and Run Railway End-to-End Qualification

**Files:**
- Modify Core release/version metadata only if the repository release flow requires it.
- Modify Bot Worker image digest constant.
- Finalize: `validation/slimming-measurements.json`
- Update relevant README/CHANGELOG entries after measured behavior is known.

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: immutable qualified Worker image digest used by Control Plane.

- [ ] **Step 1: Run fresh full local verification before publish/deploy**

Core: full Python Worker suite, `runtime` typecheck/tests, build/compiled-runtime checks, `git diff --check`.

Bot: full tests/build, `git diff --check`.

Expected: all required checks PASS before any image pin or deployment claim.

- [ ] **Step 2: Build/publish the immutable Worker image through the repository's existing release mechanism**

Record exact Core commit, version and image digest. Do not use a moving tag in Bot production configuration.

- [ ] **Step 3: Update Bot image pin and deploy Control Plane**

Keep Control image Core-free. Provision/bind a Worker through the real Railway path.

- [ ] **Step 4: Railway lifecycle qualification**

Verify from logs/requests: container→`/health` 200; `ready-unbound`; New Chat→`warming`→`ready`; first prompt; streaming; Delete Chat during/after execution; cleanup; generation rotation; `ready-unbound`; rebind to a different Topic; stale old-generation traffic rejected.

- [ ] **Step 5: Capture final measurements**

Record image size, cold/warm build time, health time, ready-unbound time, bind→Core-ready, prompt admission overhead before provider network, idle/bound RSS, and Delete Chat→reusable latency under `after`. Compute deltas against Task 1 baseline.

- [ ] **Step 6: Final ownership/dead-code audit**

Search both repos for retired Cloudflare code, multi-Topic Worker pool assumptions inside a single Worker, unused compatibility shims, and Control-side Core initialization. Remove only items proven dead, with tests first.

- [ ] **Step 7: Final verification and commits**

Run all full suites again and inspect Railway logs for positive steady state before declaring the migration complete.
