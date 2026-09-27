import type { BindingIdentity } from "./identity.js";

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
  lastUsedAt: number;
}

export class WorkerSupervisor {
  readonly #workers = new Map<string, WorkerSlot>();
  readonly #generation = new Map<string, number>();

  constructor(
    private readonly factory: WorkerFactory,
    private readonly options: { readonly maxWorkers: number },
  ) {
    if (options.maxWorkers < 1) throw new Error("maxWorkers must be >= 1");
  }

  async ensure(binding: BindingIdentity): Promise<TopicWorker> {
    const existing = this.#workers.get(binding.bindingId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.worker;
    }

    await this.#makeRoom();
    const generation = (this.#generation.get(binding.bindingId) ?? 0) + 1;
    this.#generation.set(binding.bindingId, generation);
    const worker = this.factory(binding, generation);
    await worker.start(binding);
    this.#workers.set(binding.bindingId, { worker, lastUsedAt: Date.now() });
    return worker;
  }

  async replace(binding: BindingIdentity, reason: string): Promise<TopicWorker> {
    await this.stop(binding.bindingId, reason);
    return this.ensure(binding);
  }

  async stop(bindingId: string, reason: string): Promise<void> {
    const slot = this.#workers.get(bindingId);
    if (!slot) return;
    this.#workers.delete(bindingId);
    await slot.worker.stop(reason);
  }

  async workerCrashed(binding: BindingIdentity): Promise<TopicWorker> {
    this.#workers.delete(binding.bindingId);
    return this.ensure(binding);
  }

  size(): number {
    return this.#workers.size;
  }

  idleCount(): number {
    return [...this.#workers.values()].filter((slot) => slot.worker.idle).length;
  }

  async stopAll(reason: string): Promise<void> {
    const bindingIds = [...this.#workers.keys()];
    await Promise.all(bindingIds.map((bindingId) => this.stop(bindingId, reason)));
  }

  async #makeRoom(): Promise<void> {
    if (this.#workers.size < this.options.maxWorkers) return;
    const idle = [...this.#workers.values()]
      .filter((slot) => slot.worker.idle)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!idle) throw new Error("worker capacity exhausted: no idle worker can be evicted");
    await this.stop(idle.worker.bindingId, "railway_resource_budget");
  }
}
