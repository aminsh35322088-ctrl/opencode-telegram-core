/**
 * Legacy in-process multi-Topic runtime surface.
 *
 * The Railway Worker production path does not import this module. It exists only
 * for migration compatibility and internal regression coverage until the Bot's
 * retired local-Core adapter is removed.
 */
export * from "./runtime/atomic-binding-store.js";
export * from "./runtime/binding-registry.js";
export * from "./runtime/worker-supervisor.js";
export * from "./opencode/session-event-router.js";
export * from "./scheduler/task-dispatcher.js";
export * from "./telegram/rich-stream.js";
