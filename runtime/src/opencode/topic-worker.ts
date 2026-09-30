import {
  QueuePoisonedError,
  SerialTaskQueue,
} from "../runtime/serial-task-queue.js";
import path from "node:path";
import { DeadlineExceededError, withDeadline } from "../runtime/deadline.js";
import { sameBinding, sameRun, type BindingIdentity, type RunIdentity } from "../runtime/identity.js";
import type { TopicWorker, WorkerFactory } from "../runtime/worker-supervisor.js";
import { TemporarySessionRunner, type TemporarySessionLease, type TemporarySessionOptions, type TemporarySessionPort } from "./temporary-session.js";
import { pollRunResult, type PollOutcome, type PollOptions } from "../runtime/result-poller.js";

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
  readonly abortSession?: (target: OpenCodeAbortTarget, signal: AbortSignal) => Promise<void>;
  readonly temporarySessionPort?: TemporarySessionPort;
  readonly onIsolationFailure?: (
    binding: BindingIdentity,
    error: QueuePoisonedError,
  ) => Promise<void> | void;
}

export interface OpenCodeAbortTarget {
  readonly sessionId: string;
  readonly directory: string;
}

export interface OpenCodeTaskContext {
  readonly signal: AbortSignal;
  setAbortTarget(target: OpenCodeAbortTarget | null): void;
  withTemporarySession<T>(options: TemporarySessionOptions, operation: (session: TemporarySessionLease) => Promise<T>): Promise<T>;
  poll<T>(read: (signal: AbortSignal) => Promise<PollOutcome<T>>, options: Pick<PollOptions, "timeoutMs" | "intervalMs" | "maxAttempts">): Promise<T>;
}

export interface OpenCodeTaskOptions {
  readonly abortTarget?: OpenCodeAbortTarget | null;
  readonly timeoutMs?: number;
}

export class OpenCodeTopicWorker implements TopicWorker {
  readonly bindingId: string;
  readonly generation: number;

  #started = false;
  #stopped = false;
  #poisoned = false;
  #binding: BindingIdentity;
  #activeRun: RunIdentity | null = null;
  #activeAbortTarget: OpenCodeAbortTarget | null = null;
  #ownedTask: object | null = null;
  readonly #controller = new AbortController();
  readonly #inFlight = new Set<Promise<unknown>>();
  readonly #queue: SerialTaskQueue;

  constructor(
    binding: BindingIdentity,
    generation: number,
    private readonly client: OpenCodePromptPort | null,
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
    return this.#started && !this.#stopped && !this.poisoned && this.#activeRun === null && this.#ownedTask === null && this.#inFlight.size === 0;
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

  async executeTask<T>(
    run: RunIdentity,
    label: string,
    operation: (context: OpenCodeTaskContext) => Promise<T>,
    options: OpenCodeTaskOptions = {},
  ): Promise<T> {
    this.#assertRun(run);
    if (this.poisoned) throw new Error("worker isolation boundary is poisoned");
    if (this.#ownedTask || this.#inFlight.size > 0) throw new Error("worker already owns an active task");
    if (this.#activeRun && !sameRun(this.#activeRun, run)) throw new Error("worker already owns an active run");

    const target = this.#normalizeAbortTarget(options.abortTarget === undefined
      ? { sessionId: run.sessionId, directory: run.normalizedDirectory }
      : options.abortTarget);
    const token = {};
    this.#activeRun = run;
    this.#activeAbortTarget = target;
    this.#ownedTask = token;
    const assertActive = (): void => {
      if (this.poisoned) throw new Error("worker isolation boundary is poisoned");
      if (this.#stopped || this.#ownedTask !== token || !this.#activeRun || !sameRun(this.#activeRun, run)) {
        throw new Error("owned task is inactive");
      }
    };

    try {
      return await this.#enqueue(label, async (signal) => {
        assertActive();
        signal.throwIfAborted();
        let temporaryActive = false;
        const result = await operation({
          signal,
          poll: (read, pollOptions) => {
            assertActive();
            return pollRunResult(run, read, { ...pollOptions, signal, isCurrent: () => {
              try { assertActive(); return true; } catch { return false; }
            } });
          },
          setAbortTarget: (next) => {
            assertActive();
            signal.throwIfAborted();
            if (temporaryActive) throw new Error("temporary session owns the abort target");
            this.#activeAbortTarget = this.#normalizeAbortTarget(next);
          },
          withTemporarySession: async (sessionOptions, callback) => {
            assertActive();
            signal.throwIfAborted();
            if (temporaryActive) throw new Error("owned task already has an active temporary session");
            if (!this.options.temporarySessionPort) throw new Error("temporary session port is not configured");
            temporaryActive = true;
            const previousTarget = this.#activeAbortTarget;
            try {
              return await new TemporarySessionRunner(this.options.temporarySessionPort, this.options.stopTimeoutMs).run(
                { sessionId: run.sessionId, directory: run.normalizedDirectory }, sessionOptions, callback, signal, {
                  acquire: (session) => { assertActive(); this.#activeAbortTarget = this.#normalizeAbortTarget(session); },
                  release: () => {
                    if (this.#ownedTask === token && this.#activeRun && sameRun(this.#activeRun, run)) this.#activeAbortTarget = previousTarget;
                  },
                  cleanupFailed: (error) => {
                    this.#poisoned = true;
                    const failure = new QueuePoisonedError("temporary session cleanup failed; worker cannot be reused", error);
                    void Promise.resolve().then(() => this.options.onIsolationFailure?.(this.#binding, failure)).catch(() => undefined);
                  },
                },
              );
            } finally { temporaryActive = false; }
          },
        });
        if (temporaryActive) throw new Error("owned task returned before temporary session completed");
        assertActive();
        signal.throwIfAborted();
        return result;
      }, options.timeoutMs);
    } catch (error) {
      try {
        if (!this.#stopped && this.#ownedTask === token && this.#activeAbortTarget) {
          const failedTarget = this.#activeAbortTarget;
          await withDeadline((signal) => this.options.abortSession!(failedTarget, signal), {
            timeoutMs: this.options.stopTimeoutMs, label: "failed task cleanup",
          });
        }
      } catch (cleanupError) {
        this.#poisoned = true;
        const failure = new QueuePoisonedError("remote task cleanup failed; worker cannot be reused", cleanupError);
        void Promise.resolve().then(() => this.options.onIsolationFailure?.(this.#binding, failure)).catch(() => undefined);
        throw new AggregateError([error, cleanupError], "owned task and remote cleanup failed");
      } finally {
        this.complete(run);
      }
      throw error;
    } finally {
      if (this.#ownedTask === token) this.#ownedTask = null;
      if (!this.#activeRun && !this.poisoned) this.#activeAbortTarget = null;
    }
  }

  complete(run: RunIdentity): void {
    if (!this.#activeRun || !sameRun(this.#activeRun, run)) return;
    this.#activeRun = null;
    if (!this.#ownedTask && !this.poisoned) this.#activeAbortTarget = null;
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
    const client = this.client;
    if (!client) throw new Error("OpenCode prompt port is not configured");
    if (this.#ownedTask) throw new Error("worker already owns an active task");
    if (this.#activeRun) throw new Error("worker already owns an active run");
    if (this.#poisoned) return Promise.reject(new Error("worker isolation boundary is poisoned"));

    return this.#enqueue(
      "prompt:" + run.runId,
      (signal) => {
        signal.throwIfAborted();
        return client.prompt(
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
  }

  #enqueue<T>(label: string, operation: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<T> {
    const task = this.#queue.enqueue(label, (taskSignal) => operation(
      AbortSignal.any([taskSignal, this.#controller.signal]),
    ), timeoutMs);
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
    const target = this.#activeAbortTarget;
    this.#activeRun = null;
    this.#activeAbortTarget = null;
    this.#controller.abort(new DOMException("Worker stopped", "AbortError"));

    if (this.#inFlight.size === 0 && !target) return;
    try {
      await withDeadline(async (signal) => {
        await Promise.all([
          Promise.allSettled([...this.#inFlight]),
          target ? this.options.abortSession!(target, signal) : Promise.resolve(),
        ]);
      }, { timeoutMs: this.options.stopTimeoutMs, label: "worker stop" });
    } catch (error) {
      if (error instanceof DeadlineExceededError) throw new WorkerStopTimeoutError(this.bindingId, this.options.stopTimeoutMs);
      throw error;
    }
  }

  #normalizeAbortTarget(target: OpenCodeAbortTarget | null): OpenCodeAbortTarget | null {
    if (target === null) return null;
    if (path.resolve(target.directory) !== path.resolve(this.#binding.normalizedDirectory)) {
      throw new Error("abort target must remain in the Topic workspace");
    }
    if (!target.sessionId.trim()) throw new Error("abort target requires a session id");
    if (!this.options.abortSession) throw new Error("OpenCode session abort port is not configured");
    return Object.freeze({ sessionId: target.sessionId, directory: path.resolve(target.directory) });
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
