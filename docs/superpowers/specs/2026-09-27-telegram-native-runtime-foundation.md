# Telegram-Native Runtime Foundation

Status: implementation baseline

This layer turns OpenCode Telegram Core from only a downstream OpenCode distribution into the runtime boundary for Telegram-native agent services.

## Non-negotiable invariants

1. Conversation execution is keyed by exact binding identity and run identity. A late event from an old run or generation is dropped before state mutation or Telegram output.
2. General/global fallback is an application policy, never an implicit Core route.
3. All mutable conversation state is binding-scoped. Provider catalog/health/rate-limit metadata may be shared.
4. Every non-long-poll Telegram API request has a finite deadline. Retry-after sleeps are bounded and abortable.
5. A timed-out queue task must cooperate with cancellation. If it does not, the queue is poisoned and the worker isolation boundary must be replaced; later tasks never run concurrently with the wedged task.
6. Empty/tool-only completions are terminal outcomes, not silent hangs.
7. Workers are lazy and bounded. Railway memory pressure is handled by evicting idle workers, never by sharing mutable topic runtime state.
8. Worker crash recovery is per binding.
9. Workspace access is canonical-realpath checked and symlink escapes are rejected.
10. Outbound Telegram mutation is gateway-only and revalidates bindingGeneration plus runId.
11. Durable scheduled execution must re-enter through normal binding/run admission and outbound gateway paths.
12. SSE/event subscriptions must be replayable and supervised; subscription failure must never leave an immortal busy state.

## PR110 freeze/hang lessons promoted into Core contracts

- Telegram API socket hangs must not block finalize queues.
- Completion queues cannot be permanently poisoned by an unresolved promise.
- Timeout is not cancellation: an operation that ignores AbortSignal causes isolation-boundary replacement before more work is accepted.
- Provider retry has an absolute ceiling.
- Missing terminal/idle events are reconciled using authoritative status.
- Old watchdog probes cannot clear replacement runs.
- Event subscription startup and long-lived lifecycle are separate states.
- Cross-topic reply/media enrichment is forbidden.
- Unbound scheduled tasks do not execute.
- User-visible/runtime terminal reasons are explicit for all exits.

## Initial module boundaries

- runtime identity: binding/run fencing identity.
- binding registry: canonical fail-closed route registry.
- run registry: active execution ownership.
- serial task queue: bounded, cancellation-aware serialization.
- outbound gateway: final route/run validation before Telegram mutations.
- worker supervisor: Railway-bounded lazy lifecycle.
- workspace guard: canonical filesystem boundary.
- Telegram API budget: request deadline and retry budget.

Presentation, grammY gateway, OpenCode adapter, durable scheduler, persistent registry, Rich Message streaming, and child-process IPC are layered on this foundation.

The runtime remains modular: grammY owns Telegram protocol mechanics, OpenCode owns agent/session/model execution, and this Core owns identity, lifecycle, isolation, rendering policy, and the contract between them.
