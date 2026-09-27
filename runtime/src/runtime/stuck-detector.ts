import type { RunIdentity } from "./identity.js";
import type { RunRegistry } from "./run-registry.js";

interface StuckState {
  readonly runId: string;
  lastFingerprint: string | null;
  repeats: number;
}

export type StuckObservation = "stale" | "ok" | "stuck";

export class PerRunStuckDetector {
  readonly #states = new Map<string, StuckState>();

  constructor(
    private readonly runs: RunRegistry,
    private readonly repeatThreshold = 5,
  ) {
    if (repeatThreshold < 2) throw new Error("repeatThreshold must be >= 2");
  }

  observeTool(run: RunIdentity, toolName: string, args: unknown): StuckObservation {
    if (!this.runs.accepts(run)) return "stale";
    const fingerprint = toolName + ":" + stableJson(args);
    let state = this.#states.get(run.bindingId);
    if (!state || state.runId !== run.runId) {
      state = { runId: run.runId, lastFingerprint: null, repeats: 0 };
      this.#states.set(run.bindingId, state);
    }

    if (state.lastFingerprint === fingerprint) {
      state.repeats += 1;
    } else {
      state.lastFingerprint = fingerprint;
      state.repeats = 1;
    }
    return state.repeats >= this.repeatThreshold ? "stuck" : "ok";
  }

  markProgress(run: RunIdentity): boolean {
    if (!this.runs.accepts(run)) return false;
    this.#states.set(run.bindingId, {
      runId: run.runId,
      lastFingerprint: null,
      repeats: 0,
    });
    return true;
  }

  clear(run: RunIdentity): void {
    const state = this.#states.get(run.bindingId);
    if (state?.runId === run.runId) this.#states.delete(run.bindingId);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}
