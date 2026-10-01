import { withDeadline } from "../runtime/deadline.js";
import type { RunIdentity } from "../runtime/identity.js";
import type { RunActivity, RunRegistry, RuntimeExecutionInfo } from "../runtime/run-registry.js";

export interface OpenCodeExecutionTarget {
  readonly sessionId: string;
  readonly directory: string;
  readonly runId: string;
}

/** Transport adapter to the authoritative runtime's session control API. */
export interface OpenCodeExecutionControlPort {
  execution(target: OpenCodeExecutionTarget, signal: AbortSignal): Promise<RuntimeExecutionInfo | null>;
  pause(target: OpenCodeExecutionTarget, signal: AbortSignal): Promise<RuntimeExecutionInfo>;
  resume(target: OpenCodeExecutionTarget, signal: AbortSignal): Promise<RuntimeExecutionInfo>;
}

export interface CapturedExecutionTarget {
  readonly target: OpenCodeExecutionTarget;
  readonly isCurrent: () => boolean;
}

interface ControlState {
  tail: Promise<void>;
  uncertain: boolean;
}

/** Serializes runtime requests and mirrors acknowledgments; owns no runtime fibers. */
export class OpenCodeExecutionClient {
  readonly #controls = new WeakMap<RunActivity, ControlState>();

  constructor(
    private readonly runs: RunRegistry,
    private readonly capture: (run: RunIdentity) => CapturedExecutionTarget,
    private readonly port: OpenCodeExecutionControlPort,
    private readonly timeoutMs: number,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("execution control deadline must be positive and finite");
  }

  async request(run: RunIdentity, action: "execution" | "pause" | "resume", signal?: AbortSignal): Promise<RuntimeExecutionInfo> {
    signal?.throwIfAborted();
    const owner = Object.freeze({ ...run });
    const captured = this.capture(owner);
    const activity = this.runs.activity(owner);
    let state = this.#controls.get(activity);
    if (!state) {
      state = { tail: Promise.resolve(), uncertain: false };
      this.#controls.set(activity, state);
    }
    if (state.uncertain) throw new Error("runtime execution control is uncertain; explicit abort or retirement required");
    const release = this.runs.holdExecution(owner);
    const control = state;
    const pending = control.tail.then(async () => {
      let requested = false;
      try {
        if (control.uncertain) throw new Error("runtime execution control is uncertain; explicit abort or retirement required");
        signal?.throwIfAborted();
        if (!this.runs.accepts(owner) || !captured.isCurrent()) throw new Error("stale runtime execution target");
        const info = await withDeadline((requestSignal) => {
          if (!this.runs.accepts(owner) || !captured.isCurrent()) throw new Error("stale runtime execution target");
          requested = true;
          return this.port[action](captured.target, requestSignal);
        }, {
          timeoutMs: this.timeoutMs, label: "runtime execution " + action,
          ...(signal ? { parentSignal: signal } : {}),
        });
        if (!this.runs.accepts(owner) || !captured.isCurrent()) throw new Error("stale runtime execution acknowledgment");
        if (!info || info.runId !== owner.runId || info.continuation !== "live" ||
          typeof info.paused !== "boolean" || (action !== "execution" && info.paused !== (action === "pause"))) {
          throw new Error("runtime execution acknowledgment is stale or unavailable");
        }
        this.runs.observeExecution(owner, info);
        return Object.freeze({ ...info });
      } catch (error) {
        // A failed/late HTTP request can have changed runtime state. Keep client
        // work parked until explicit cleanup; a GET cannot order a timed-out write.
        if (requested) control.uncertain = true;
        throw error;
      } finally {
        if (!control.uncertain) release();
      }
    });
    control.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}
