import { sameBinding, type BindingIdentity } from "./identity.js";

export interface TopicWorker {
  readonly bindingId: string;
  readonly generation: number;
  readonly idle: boolean;
  start(binding: BindingIdentity): Promise<void>;
  stop(reason: string): Promise<void>;
}

export type WorkerFactory = (binding: BindingIdentity, generation: number) => TopicWorker;

interface WorkerSlot {
  worker: TopicWorker;
  binding: BindingIdentity;
  lastUsedAt: number;
}

interface PendingCreation {
  binding: BindingIdentity;
  cancelled: boolean;
  promise: Promise<TopicWorker>;
}

interface Retirement {
  promise: Promise<void>;
  capacityClaimed: boolean;
}

export class WorkerSupervisor {
  readonly #workers = new Map<string, WorkerSlot>();
  readonly #generation = new Map<string, number>();
  readonly #pending = new Map<string, PendingCreation>();
  readonly #retiring = new Map<string, Retirement>();
  readonly #lifecycleEpoch = new Map<string, number>();
  #reservedStarts = 0;

  constructor(
    private readonly factory: WorkerFactory,
    private readonly options: { readonly maxWorkers: number },
  ) {
    if (options.maxWorkers < 1) throw new Error("maxWorkers must be >= 1");
  }

  async ensure(binding: BindingIdentity): Promise<TopicWorker> {
    const retiring = this.#retiring.get(binding.bindingId);
    if (retiring) {
      await retiring.promise;
      return this.ensure(binding);
    }

    const existing = this.#workers.get(binding.bindingId);
    if (existing) {
      this.#assertSameBinding(existing.binding, binding);
      existing.lastUsedAt = Date.now();
      return existing.worker;
    }

    const inflight = this.#pending.get(binding.bindingId);
    if (inflight) {
      this.#assertSameBinding(inflight.binding, binding);
      return inflight.promise;
    }

    const state = {
      binding: Object.freeze({ ...binding }),
      cancelled: false,
      promise: undefined as unknown as Promise<TopicWorker>,
    };
    const creation = Promise.resolve().then(() => this.#create(state));
    state.promise = creation;
    this.#pending.set(binding.bindingId, state);

    try {
      return await creation;
    } finally {
      if (this.#pending.get(binding.bindingId) === state) {
        this.#pending.delete(binding.bindingId);
      }
    }
  }

  async replace(binding: BindingIdentity, reason: string): Promise<TopicWorker> {
    await this.stop(binding.bindingId, reason);
    return this.ensure(binding);
  }

  async stop(bindingId: string, reason: string): Promise<void> {
    this.#bumpLifecycleEpoch(bindingId);
    const pending = this.#pending.get(bindingId);
    if (pending) pending.cancelled = true;

    const existingRetirement = this.#retiring.get(bindingId);
    const slot = this.#workers.get(bindingId);
    if (slot) {
      this.#workers.delete(bindingId);
      await this.#retire(slot, reason).promise;
    } else if (existingRetirement) {
      await existingRetirement.promise;
    }

    if (pending) {
      await pending.promise.catch(() => undefined);
    }
  }

  async stopIfCurrent(
    binding: BindingIdentity,
    worker: TopicWorker,
    reason: string,
  ): Promise<boolean> {
    const slot = this.#workers.get(binding.bindingId);
    if (!slot || slot.worker !== worker || !sameBinding(slot.binding, binding)) {
      return false;
    }
    this.#bumpLifecycleEpoch(binding.bindingId);
    this.#workers.delete(binding.bindingId);
    await this.#retire(slot, reason).promise;
    return true;
  }

  async workerCrashed(
    binding: BindingIdentity,
    workerGeneration: number,
  ): Promise<TopicWorker> {
    const slot = this.#workers.get(binding.bindingId);
    if (
      !slot ||
      slot.worker.generation !== workerGeneration ||
      !sameBinding(slot.binding, binding)
    ) {
      throw new Error("stale worker crash notification");
    }

    const lifecycleEpoch = this.#lifecycleEpoch.get(binding.bindingId) ?? 0;
    this.#workers.delete(binding.bindingId);
    await this.#retire(slot, "worker_crashed").promise;

    if ((this.#lifecycleEpoch.get(binding.bindingId) ?? 0) !== lifecycleEpoch) {
      throw new Error("worker crash recovery superseded by lifecycle change");
    }
    return this.ensure(binding);
  }

  isCurrent(binding: BindingIdentity, worker: TopicWorker): boolean {
    const slot = this.#workers.get(binding.bindingId);
    return Boolean(
      slot &&
      slot.worker === worker &&
      sameBinding(slot.binding, binding),
    );
  }

  size(): number {
    return (
      this.#workers.size +
      this.#reservedStarts +
      this.#unclaimedRetirementCount()
    );
  }

  idleCount(): number {
    return [...this.#workers.values()].filter((slot) => slot.worker.idle).length;
  }

  async stopAll(reason: string): Promise<void> {
    const bindingIds = new Set([
      ...this.#workers.keys(),
      ...this.#pending.keys(),
      ...this.#retiring.keys(),
    ]);
    await Promise.all([...bindingIds].map((bindingId) => this.stop(bindingId, reason)));
  }

  async #create(state: PendingCreation): Promise<TopicWorker> {
    if (state.cancelled) throw new Error("worker creation cancelled before start");
    const eviction = this.#reserveSlot();

    try {
      if (eviction) {
        await eviction;
      }
      if (state.cancelled) {
        throw new Error("worker creation cancelled before start");
      }

      const binding = state.binding;
      const generation = (this.#generation.get(binding.bindingId) ?? 0) + 1;
      this.#generation.set(binding.bindingId, generation);
      const worker = this.factory(binding, generation);

      try {
        await worker.start(binding);
      } catch (error) {
        await worker.stop("worker_start_failed").catch(() => undefined);
        throw error;
      }

      if (state.cancelled) {
        await worker.stop("worker_creation_cancelled").catch(() => undefined);
        throw new Error("worker creation cancelled during start");
      }

      this.#workers.set(binding.bindingId, {
        worker,
        binding,
        lastUsedAt: Date.now(),
      });
      return worker;
    } finally {
      this.#reservedStarts -= 1;
    }
  }

  #reserveSlot(): Promise<void> | null {
    const occupied =
      this.#workers.size +
      this.#reservedStarts +
      this.#unclaimedRetirementCount();

    if (occupied < this.options.maxWorkers) {
      this.#reservedStarts += 1;
      return null;
    }

    // A worker that is still stopping still consumes Railway capacity. Claim
    // that future slot atomically before waiting so only one new start can use
    // the capacity released by this retirement.
    const retirement = [...this.#retiring.values()].find(
      (entry) => !entry.capacityClaimed,
    );
    if (retirement) {
      retirement.capacityClaimed = true;
      this.#reservedStarts += 1;
      return retirement.promise;
    }

    const idle = [...this.#workers.values()]
      .filter((slot) => slot.worker.idle)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!idle) {
      throw new Error("worker capacity exhausted: no idle worker can be evicted");
    }

    this.#workers.delete(idle.worker.bindingId);
    this.#reservedStarts += 1;
    return this.#retire(idle, "railway_resource_budget", true).promise;
  }

  #retire(
    slot: WorkerSlot,
    reason: string,
    capacityClaimed = false,
  ): Retirement {
    const bindingId = slot.binding.bindingId;
    const existing = this.#retiring.get(bindingId);
    if (existing) {
      if (capacityClaimed) existing.capacityClaimed = true;
      return existing;
    }

    const retirement: Retirement = {
      promise: undefined as unknown as Promise<void>,
      capacityClaimed,
    };
    retirement.promise = Promise.resolve()
      .then(() => slot.worker.stop(reason))
      .finally(() => {
        if (this.#retiring.get(bindingId) === retirement) {
          this.#retiring.delete(bindingId);
        }
      });
    this.#retiring.set(bindingId, retirement);
    return retirement;
  }

  #unclaimedRetirementCount(): number {
    let count = 0;
    for (const retirement of this.#retiring.values()) {
      if (!retirement.capacityClaimed) count += 1;
    }
    return count;
  }

  #bumpLifecycleEpoch(bindingId: string): void {
    this.#lifecycleEpoch.set(
      bindingId,
      (this.#lifecycleEpoch.get(bindingId) ?? 0) + 1,
    );
  }

  #assertSameBinding(actual: BindingIdentity, expected: BindingIdentity): void {
    if (!sameBinding(actual, expected)) {
      throw new Error(
        "worker binding identity mismatch; stop or replace the stale worker before reuse",
      );
    }
  }
}
