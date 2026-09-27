import {
  QueuePoisonedError,
  SerialTaskQueue,
} from "../runtime/serial-task-queue.js";
import { sameBinding, type BindingIdentity, type RunIdentity } from "../runtime/identity.js";
import type { TopicWorker, WorkerFactory } from "../runtime/worker-supervisor.js";

export interface OpenCodePromptPort {
  prompt(
    sessionId: string,
    prompt: {
      readonly text: string;
      readonly files?: readonly {
        readonly uri: string;
        readonly name?: string;
        readonly description?: string;
      }[];
    },
    options?: {
      readonly id?: string;
      readonly delivery?: "steer" | "queue";
      readonly resume?: boolean;
      readonly signal?: AbortSignal;
    },
  ): Promise<{
    readonly admittedSeq: number;
    readonly id: string;
    readonly sessionID: string;
    readonly delivery: "steer" | "queue";
    readonly timeCreated: number;
  }>;
}

export class WorkerStopTimeoutError extends Error {
  constructor(readonly bindingId: string, readonly timeoutMs: number) {
    super(`worker ${bindingId} did not stop within ${timeoutMs}ms`);
    this.name = "WorkerStopTimeoutError";
  }
}

export interface OpenCodeTopicWorkerOptions {
  readonly promptTimeoutMs: number;
  readonly cancellationGraceMs: number;
  readonly stopTimeoutMs: number;
  readonly onIsolationFailure?: (
    binding: BindingIdentity,
    error: QueuePoisonedError,
  ) => Promise<void> | void;
}

export class OpenCodeTopicWorker implements TopicWorker {
  readonly bindingId: string;
  readonly generation: number;

  #started = false;
  #stopped = false;
  #poisoned = false;
  #binding: BindingIdentity;
  readonly #controller = new AbortController();
  readonly #inFlight = new Set<Promise<unknown>>();
  readonly #queue: SerialTaskQueue;

  constructor(
    binding: BindingIdentity,
    generation: number,
    private readonly client: OpenCodePromptPort,
    private readonly options: OpenCodeTopicWorkerOptions,
  ) {
    this.bindingId = binding.bindingId;
    this.generation = generation;
    this.#binding = binding;
    this.#queue = new SerialTaskQueue({
      defaultTimeoutMs: options.promptTimeoutMs,
      cancellationGraceMs: options.cancellationGraceMs,
      onUncooperativeTask: async (error) => {
        this.#poisoned = true;
        await options.onIsolationFailure?.(this.#binding, error);
      },
    });
  }

  get idle(): boolean {
    return this.#started && !this.#stopped && !this.#poisoned && this.#inFlight.size === 0;
  }

  get poisoned(): boolean {
    return this.#poisoned || this.#queue.poisoned;
  }

  async start(binding: BindingIdentity): Promise<void> {
    if (this.#stopped) throw new Error("cannot restart stopped worker instance");
    if (binding.bindingId !== this.bindingId || !sameBinding(binding, this.#binding)) {
      throw new Error("worker start binding mismatch");
    }
    this.#binding = binding;
    this.#started = true;
  }

  executePrompt(
    run: RunIdentity,
    prompt: {
      readonly text: string;
      readonly files?: readonly {
        readonly uri: string;
        readonly name?: string;
        readonly description?: string;
      }[];
    },
    options: {
      readonly delivery?: "steer" | "queue";
      readonly resume?: boolean;
    } = {},
  ): Promise<{
    readonly admittedSeq: number;
    readonly id: string;
    readonly sessionID: string;
    readonly delivery: "steer" | "queue";
    readonly timeCreated: number;
  }> {
    this.#assertRun(run);
    if (this.#poisoned) return Promise.reject(new Error("worker isolation boundary is poisoned"));

    const task = this.#queue.enqueue(
      "prompt:" + run.runId,
      (taskSignal) => {
        const signal = AbortSignal.any([taskSignal, this.#controller.signal]);
        signal.throwIfAborted();
        return this.client.prompt(
          run.sessionId,
          prompt,
          {
            id: run.runId,
            delivery: options.delivery ?? "queue",
            resume: options.resume ?? true,
            signal,
          },
        );
      },
      this.options.promptTimeoutMs,
    );

    this.#inFlight.add(task);
    void task.then(
      () => this.#inFlight.delete(task),
      () => this.#inFlight.delete(task),
    );
    return task;
  }

  async stop(_reason: string): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#controller.abort(new DOMException("Worker stopped", "AbortError"));

    if (this.#inFlight.size === 0) return;
    const settled = Promise.allSettled([...this.#inFlight]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new WorkerStopTimeoutError(this.bindingId, this.options.stopTimeoutMs)),
        this.options.stopTimeoutMs,
      );
    });
    try {
      await Promise.race([settled, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  #assertRun(run: RunIdentity): void {
    if (!this.#started || this.#stopped) throw new Error("worker is not active");
    if (
      run.workerGeneration !== this.generation ||
      !sameBinding(run, this.#binding)
    ) {
      throw new Error("run does not belong to this worker lease");
    }
  }
}

export function createOpenCodeTopicWorkerFactory(
  client: OpenCodePromptPort,
  options: OpenCodeTopicWorkerOptions,
): WorkerFactory {
  return (binding, generation) =>
    new OpenCodeTopicWorker(binding, generation, client, options);
}
