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

export class WorkerSupervisor {
  readonly #workers = new Map<string, WorkerSlot>();
  readonly #generation = new Map<string, number>();
  #lifecycleLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly factory: WorkerFactory,
    private readonly options: { readonly maxWorkers: number },
  ) {
    if (options.maxWorkers < 1) throw new Error("maxWorkers must be >= 1");
  }

  async ensure(binding: BindingIdentity): Promise<TopicWorker> {
    return this.#withLifecycleLock(async () => {
      const existing = this.#workers.get(binding.bindingId);
      if (existing) {
        if (!sameBinding(existing.binding, binding)) {
          throw new Error(
            "worker binding identity mismatch; stop or replace the stale worker before reuse",
          );
        }
        existing.lastUsedAt = Date.now();
        return existing.worker;
      }
      return this.#createUnlocked(binding);
    });
  }

  async replace(binding: BindingIdentity, reason: string): Promise<TopicWorker> {
    return this.#withLifecycleLock(async () => {
      await this.#stopUnlocked(binding.bindingId, reason);
      return this.#createUnlocked(binding);
    });
  }

  async stop(bindingId: string, reason: string): Promise<void> {
    return this.#withLifecycleLock(() => this.#stopUnlocked(bindingId, reason));
  }

  async workerCrashed(binding: BindingIdentity): Promise<TopicWorker> {
    return this.#withLifecycleLock(async () => {
      this.#workers.delete(binding.bindingId);
      return this.#createUnlocked(binding);
    });
  }

  size(): number {
    return this.#workers.size;
  }

  idleCount(): number {
    return [...this.#workers.values()].filter((slot) => slot.worker.idle).length;
  }

  async stopAll(reason: string): Promise<void> {
    return this.#withLifecycleLock(async () => {
      const bindingIds = [...this.#workers.keys()];
      await Promise.all(
        bindingIds.map((bindingId) => this.#stopUnlocked(bindingId, reason)),
      );
    });
  }

  async #createUnlocked(binding: BindingIdentity): Promise<TopicWorker> {
    await this.#makeRoomUnlocked();
    const generation = (this.#generation.get(binding.bindingId) ?? 0) + 1;
    this.#generation.set(binding.bindingId, generation);

    const worker = this.factory(binding, generation);
    try {
      await worker.start(binding);
    } catch (error) {
      await worker.stop("worker_start_failed").catch(() => undefined);
      throw error;
    }

    this.#workers.set(binding.bindingId, {
      worker,
      binding: Object.freeze({ ...binding }),
      lastUsedAt: Date.now(),
    });
    return worker;
  }

  async #stopUnlocked(bindingId: string, reason: string): Promise<void> {
    const slot = this.#workers.get(bindingId);
    if (!slot) return;
    this.#workers.delete(bindingId);
    await slot.worker.stop(reason);
  }

  async #makeRoomUnlocked(): Promise<void> {
    if (this.#workers.size < this.options.maxWorkers) return;
    const idle = [...this.#workers.values()]
      .filter((slot) => slot.worker.idle)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!idle) {
      throw new Error("worker capacity exhausted: no idle worker can be evicted");
    }
    await this.#stopUnlocked(idle.worker.bindingId, "railway_resource_budget");
  }

  async #withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
    const predecessor = this.#lifecycleLock;
    let release!: () => void;
    this.#lifecycleLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
