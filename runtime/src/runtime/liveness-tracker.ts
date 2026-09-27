import type { RunIdentity } from "./identity.js";
import type { RunRegistry } from "./run-registry.js";

interface ToolActivity {
  readonly startedAt: number;
}

interface LivenessState {
  readonly run: RunIdentity;
  lastActivityAt: number;
  readonly activeTools: Map<string, ToolActivity>;
}

export type LivenessAssessment =
  | "stale"
  | "healthy"
  | "stalled"
  | "tool_timeout";

export class RunLivenessTracker {
  readonly #states = new Map<string, LivenessState>();

  constructor(private readonly runs: RunRegistry) {}

  start(run: RunIdentity, now = Date.now()): boolean {
    if (!this.runs.accepts(run)) return false;
    this.#states.set(run.bindingId, {
      run,
      lastActivityAt: now,
      activeTools: new Map(),
    });
    return true;
  }

  touch(run: RunIdentity, now = Date.now()): boolean {
    const state = this.#current(run);
    if (!state) return false;
    state.lastActivityAt = now;
    return true;
  }

  toolStarted(run: RunIdentity, toolCallId: string, now = Date.now()): boolean {
    const state = this.#current(run);
    if (!state) return false;
    state.activeTools.set(toolCallId, { startedAt: now });
    state.lastActivityAt = now;
    return true;
  }

  toolFinished(run: RunIdentity, toolCallId: string, now = Date.now()): boolean {
    const state = this.#current(run);
    if (!state) return false;
    state.activeTools.delete(toolCallId);
    state.lastActivityAt = now;
    return true;
  }

  assess(
    run: RunIdentity,
    options: {
      readonly now?: number;
      readonly stallAfterMs: number;
      readonly toolTimeoutMs: number;
    },
  ): LivenessAssessment {
    const state = this.#current(run);
    if (!state) return "stale";
    const now = options.now ?? Date.now();

    for (const tool of state.activeTools.values()) {
      if (now - tool.startedAt >= options.toolTimeoutMs) return "tool_timeout";
    }
    if (state.activeTools.size > 0) return "healthy";
    return now - state.lastActivityAt >= options.stallAfterMs ? "stalled" : "healthy";
  }

  clear(run: RunIdentity): boolean {
    const state = this.#current(run);
    if (!state) return false;
    this.#states.delete(run.bindingId);
    return true;
  }

  #current(run: RunIdentity): LivenessState | null {
    if (!this.runs.accepts(run)) return null;
    const state = this.#states.get(run.bindingId);
    if (
      !state ||
      state.run.runId !== run.runId ||
      state.run.bindingGeneration !== run.bindingGeneration ||
      state.run.workerGeneration !== run.workerGeneration
    ) {
      return null;
    }
    return state;
  }
}
