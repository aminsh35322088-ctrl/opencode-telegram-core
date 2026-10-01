import path from "node:path";
import { withDeadline } from "../runtime/deadline.js";
import type { RunActivity } from "../runtime/run-registry.js";

export interface SessionOwner {
  readonly sessionId: string;
  readonly directory: string;
}

export interface TemporarySessionOptions {
  readonly title: string;
  readonly model?: { readonly providerID: string; readonly id: string };
}

export interface TemporarySessionIdentity extends SessionOwner {
  readonly parentSessionId: string;
}

export interface TemporarySessionLease extends TemporarySessionIdentity {
  readonly signal: AbortSignal;
  retainForInspection(): void;
}

export interface TemporarySessionPort {
  get(owner: SessionOwner, signal: AbortSignal): Promise<SessionOwner>;
  create(owner: SessionOwner, options: TemporarySessionOptions, signal: AbortSignal): Promise<TemporarySessionIdentity>;
  abort(session: SessionOwner, signal: AbortSignal): Promise<void>;
  remove(session: SessionOwner, signal: AbortSignal): Promise<void>;
}

export class TemporarySessionRunner {
  constructor(private readonly port: TemporarySessionPort, private readonly cleanupTimeoutMs = 5_000) {
    if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0) throw new Error("temporary session cleanup deadline must be positive");
  }

  async run<T>(
    inputOwner: SessionOwner,
    options: TemporarySessionOptions,
    operation: (session: TemporarySessionLease) => Promise<T>,
    signal: AbortSignal,
    lifecycle?: {
      readonly acquire: (session: TemporarySessionIdentity) => void;
      readonly release: () => void;
      readonly cleanupFailed?: (error: unknown) => void;
      readonly activity?: RunActivity;
      readonly beginCleanup?: () => void;
    },
  ): Promise<T> {
    signal.throwIfAborted();
    if (!inputOwner.sessionId.trim() || !inputOwner.directory.trim()) throw new Error("temporary session requires an exact owner");
    const owner = Object.freeze({ sessionId: inputOwner.sessionId, directory: path.resolve(inputOwner.directory) });
    const verified = await this.port.get(owner, signal);
    signal.throwIfAborted();
    if (verified.sessionId !== owner.sessionId || path.resolve(verified.directory) !== owner.directory) {
      throw new Error("temporary session owner identity mismatch");
    }
    const created = await this.port.create(owner, options, signal);
    if (!created.sessionId.trim() || created.sessionId === owner.sessionId || created.parentSessionId !== owner.sessionId || path.resolve(created.directory) !== owner.directory) {
      throw new Error("temporary session identity mismatch");
    }
    const session = Object.freeze({ ...created, directory: owner.directory });
    let retained = false;
    let acquired = false;
    let completed = false;
    try {
      signal.throwIfAborted();
      lifecycle?.acquire(session);
      acquired = true;
      if (lifecycle?.activity) do { await lifecycle.activity.checkpoint(signal); } while (lifecycle.activity.paused);
      const result = await operation(Object.freeze({
        ...session, signal,
        retainForInspection: () => { signal.throwIfAborted(); retained = true; },
      }));
      signal.throwIfAborted();
      completed = true;
      return result;
    } finally {
      const failures: unknown[] = [];
      let completionError: unknown;
      try {
        while (true) {
          if (completed && !signal.aborted && lifecycle?.activity) {
            try { await lifecycle.activity.checkpoint(signal); }
            catch (error) { completionError = error; completed = false; }
          }
          const stopped = await withDeadline((cleanupSignal) => {
            // Recheck in this continuation, immediately before destruction.
            // A pause racing the awaited checkpoint parks outside cleanup's
            // wall-clock bound; cancellation still enters bounded cleanup.
            if (completed && !signal.aborted && lifecycle?.activity?.paused) return Promise.resolve(false);
            lifecycle?.beginCleanup?.();
            return this.port.abort(session, cleanupSignal).then(() => true);
          }, { timeoutMs: this.cleanupTimeoutMs, label: "temporary session cleanup" });
          if (stopped) break;
        }
      } catch (error) { failures.push(error); }
      if (!retained || signal.aborted || failures.length > 0) {
        try {
          await withDeadline((cleanupSignal) => this.port.remove(session, cleanupSignal),
            { timeoutMs: this.cleanupTimeoutMs, label: "temporary session deletion" });
        } catch (error) { failures.push(error); }
      }
      if (failures.length > 0) {
        const error = new AggregateError(failures, "temporary session cleanup failed");
        lifecycle?.cleanupFailed?.(error);
        throw error;
      }
      if (acquired) lifecycle?.release();
      if (completionError !== undefined) throw completionError;
    }
  }
}
