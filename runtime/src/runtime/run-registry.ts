import { randomUUID } from "node:crypto";
import { sameBinding, type BindingIdentity, type RunIdentity } from "./identity.js";
import type { DeadlineActivity } from "./deadline.js";

export interface RuntimeExecutionInfo {
  readonly runId: string;
  readonly paused: boolean;
  readonly continuation: "live" | "unavailable";
}

/** Client observation of runtime acknowledgments, not an execution authority. */
export interface RunActivity extends DeadlineActivity {
  checkpoint(signal?: AbortSignal): Promise<void>;
  activeTime(now?: number): number;
}

export class RunRegistry {
  readonly #active = new Map<string, { readonly run: RunIdentity; readonly observation: RunObservation }>();

  start(binding: BindingIdentity, workerGeneration: number, runId: string = randomUUID()): RunIdentity {
    const run = Object.freeze({ ...binding, workerGeneration, runId });
    const previous = this.#active.get(binding.bindingId);
    const observation = new RunObservation(() => this.#active.get(binding.bindingId)?.observation === observation);
    this.#active.set(binding.bindingId, { run, observation });
    previous?.observation.retire();
    return run;
  }

  startExclusive(
    binding: BindingIdentity,
    workerGeneration: number,
    runId: string = randomUUID(),
  ): RunIdentity {
    if (this.#active.has(binding.bindingId)) {
      throw new Error("binding already owns an active run: " + binding.bindingId);
    }
    return this.start(binding, workerGeneration, runId);
  }

  current(bindingId: string): RunIdentity | null {
    return this.#active.get(bindingId)?.run ?? null;
  }

  accepts(candidate: RunIdentity): boolean {
    const current = this.#active.get(candidate.bindingId)?.run;
    return current !== undefined &&
      sameBinding(current, candidate) &&
      current.runId === candidate.runId &&
      current.workerGeneration === candidate.workerGeneration;
  }

  finish(candidate: RunIdentity): boolean {
    if (!this.accepts(candidate)) return false;
    const observation = this.#active.get(candidate.bindingId)!.observation;
    this.#active.delete(candidate.bindingId);
    observation.retire();
    return true;
  }

  fence(bindingId: string): void {
    const observation = this.#active.get(bindingId)?.observation;
    this.#active.delete(bindingId);
    observation?.retire();
  }

  activity(run: RunIdentity): RunActivity {
    if (!this.accepts(run)) throw new Error("stale runtime execution observation");
    return this.#active.get(run.bindingId)!.observation;
  }

  observeExecution(run: RunIdentity, info: RuntimeExecutionInfo, now = Date.now()): boolean {
    if (!this.accepts(run)) return false;
    if (info.runId !== run.runId || info.continuation !== "live") {
      throw new Error("runtime execution acknowledgment is stale or unavailable");
    }
    this.#active.get(run.bindingId)!.observation.observe(info.paused, now);
    return true;
  }

  /** Hold client work and budgets while a runtime control acknowledgment is pending. */
  holdExecution(run: RunIdentity): () => void {
    if (!this.accepts(run)) throw new Error("stale runtime execution observation");
    return this.#active.get(run.bindingId)!.observation.hold();
  }
}

class RunObservation implements RunActivity {
  readonly #listeners = new Set<(error?: unknown) => void>();
  readonly #waiters = new Set<() => void>();
  #pausedAt: number | undefined;
  #pausedDuration = 0;
  #retired = false;
  #acknowledgedPause = false;
  #holds = 0;
  #failure: Error | undefined;

  constructor(private readonly isCurrent: () => boolean) {}

  get paused(): boolean { return this.#pausedAt !== undefined; }

  activeTime(now = Date.now()): number {
    return (this.#pausedAt ?? now) - this.#pausedDuration;
  }

  observe(paused: boolean, now: number): void {
    this.#assertCurrent();
    this.#acknowledgedPause = paused;
    this.#update(now);
  }

  hold(): () => void {
    this.#assertCurrent();
    this.#holds++;
    this.#update(Date.now());
    let released = false;
    return () => {
      if (released || this.#retired) return;
      released = true;
      this.#holds--;
      this.#update(Date.now());
    };
  }

  #update(now: number): void {
    const paused = this.#acknowledgedPause || this.#holds > 0;
    if (paused === this.paused) return;
    if (paused) this.#pausedAt = now;
    else {
      this.#pausedDuration += Math.max(0, now - this.#pausedAt!);
      this.#pausedAt = undefined;
    }
    this.#notify();
  }

  subscribe(listener: (error?: unknown) => void): () => void {
    this.#assertCurrent();
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  async checkpoint(signal?: AbortSignal): Promise<void> {
    while (true) {
      this.#assertCurrent();
      signal?.throwIfAborted();
      if (!this.paused) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.#waiters.delete(wake); signal?.removeEventListener("abort", abort); };
        const wake = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(signal!.reason); };
        this.#waiters.add(wake);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }

  retire(): void {
    this.#retired = true;
    this.#notify(new Error("runtime run observation retired"));
    this.#listeners.clear();
  }

  #assertCurrent(): void {
    if (this.#failure) throw this.#failure;
    if (this.#retired || !this.isCurrent()) throw new Error("stale runtime execution observation");
  }

  #notify(error?: unknown): void {
    for (const wake of [...this.#waiters]) wake();
    const failures: unknown[] = [];
    for (const listener of [...this.#listeners]) {
      try { listener(error); } catch (failure) { this.#listeners.delete(listener); failures.push(failure); }
    }
    if (failures.length > 0 && error === undefined) {
      this.#failure = new AggregateError(failures, "runtime execution observer failed");
      // Observers already notified of pause must also receive its failure,
      // otherwise their frozen deadline would hide a broken client boundary.
      for (const listener of [...this.#listeners]) {
        try { listener(this.#failure); } catch { /* Retire every observer despite individual failures. */ }
      }
      this.#listeners.clear();
      throw this.#failure;
    }
  }
}
