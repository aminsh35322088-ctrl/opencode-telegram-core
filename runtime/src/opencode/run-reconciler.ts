import { withDeadline } from "../runtime/deadline.js";
import type { RunIdentity } from "../runtime/identity.js";
import type { RunRegistry } from "../runtime/run-registry.js";

export type OpenCodeRunStatus = "busy" | "retry" | "idle" | "error";

export interface OpenCodeRunStatusPort {
  status(run: RunIdentity, signal: AbortSignal): Promise<OpenCodeRunStatus>;
  interrupt(run: RunIdentity, signal: AbortSignal): Promise<void>;
}

export type ReconcileResult =
  | "active"
  | "terminal"
  | "stale"
  | "aborted_retry_ceiling";

export class AuthoritativeRunReconciler {
  constructor(
    private readonly runs: RunRegistry,
    private readonly port: OpenCodeRunStatusPort,
    private readonly options: {
      readonly requestTimeoutMs: number;
      readonly providerRetryCeilingMs: number;
      readonly now?: () => number;
      /**
       * Completes the run. Defaults to the bare registry, which skips the
       * per-run liveness and stuck bookkeeping the core normally performs.
       */
      readonly finishRun?: (run: RunIdentity) => void;
    },
  ) {}

  #finish(run: RunIdentity): void {
    if (this.options.finishRun) {
      this.options.finishRun(run);
      return;
    }
    this.runs.finish(run);
  }

  async probe(
    run: RunIdentity,
    runStartedAt: number,
    signal?: AbortSignal,
  ): Promise<ReconcileResult> {
    if (!this.runs.accepts(run)) return "stale";
    const activity = this.runs.activity(run);
    if (activity.paused) return "active";

    const status = await withDeadline(
      (deadlineSignal) => this.port.status(run, deadlineSignal),
      {
        timeoutMs: this.options.requestTimeoutMs,
        label: "OpenCode run status probe",
        ...(signal ? { parentSignal: signal } : {}),
      },
    );

    if (!this.runs.accepts(run)) return "stale";
    if (activity.paused) return "active";

    if (status === "idle" || status === "error") {
      this.#finish(run);
      return "terminal";
    }

    const now = this.options.now ?? Date.now;
    if (status === "retry" && activity.activeTime(now()) - runStartedAt >= this.options.providerRetryCeilingMs) {
      const interrupted = await withDeadline(
        async (deadlineSignal) => {
          if (!this.runs.accepts(run) || activity.paused) return false;
          await this.port.interrupt(run, deadlineSignal);
          return true;
        },
        {
          timeoutMs: this.options.requestTimeoutMs,
          label: "OpenCode retry ceiling interrupt",
          ...(signal ? { parentSignal: signal } : {}),
        },
      );
      if (!this.runs.accepts(run)) return "stale";
      if (!interrupted) return "active";
      this.#finish(run);
      return "aborted_retry_ceiling";
    }

    return "active";
  }
}
