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
    },
  ) {}

  async probe(
    run: RunIdentity,
    runStartedAt: number,
    signal?: AbortSignal,
  ): Promise<ReconcileResult> {
    if (!this.runs.accepts(run)) return "stale";

    const status = await withDeadline(
      (deadlineSignal) => this.port.status(run, deadlineSignal),
      {
        timeoutMs: this.options.requestTimeoutMs,
        label: "OpenCode run status probe",
        ...(signal ? { parentSignal: signal } : {}),
      },
    );

    if (!this.runs.accepts(run)) return "stale";

    if (status === "idle" || status === "error") {
      this.runs.finish(run);
      return "terminal";
    }

    const now = this.options.now ?? Date.now;
    if (status === "retry" && now() - runStartedAt >= this.options.providerRetryCeilingMs) {
      await withDeadline(
        (deadlineSignal) => this.port.interrupt(run, deadlineSignal),
        {
          timeoutMs: this.options.requestTimeoutMs,
          label: "OpenCode retry ceiling interrupt",
          ...(signal ? { parentSignal: signal } : {}),
        },
      );
      if (!this.runs.accepts(run)) return "stale";
      this.runs.finish(run);
      return "aborted_retry_ceiling";
    }

    return "active";
  }
}
