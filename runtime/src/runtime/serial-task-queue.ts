import { DeadlineExceededError } from "./deadline.js";

export class QueuePoisonedError extends Error {
  constructor(message: string, readonly rootCause?: unknown) {
    super(message);
    this.name = "QueuePoisonedError";
  }
}

export class SerialTaskQueue {
  #tail: Promise<void> = Promise.resolve();
  #poisoned: QueuePoisonedError | null = null;

  constructor(
    private readonly options: {
      readonly defaultTimeoutMs: number;
      readonly cancellationGraceMs: number;
      readonly onUncooperativeTask?: (error: QueuePoisonedError) => Promise<void> | void;
    },
  ) {}

  get poisoned(): boolean {
    return this.#poisoned !== null;
  }

  enqueue<T>(
    label: string,
    task: (signal: AbortSignal) => Promise<T>,
    timeoutMs = this.options.defaultTimeoutMs,
  ): Promise<T> {
    if (this.#poisoned) return Promise.reject(this.#poisoned);

    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    this.#tail = this.#tail.then(async () => {
      if (this.#poisoned) {
        rejectResult(this.#poisoned);
        return;
      }

      const controller = new AbortController();
      let taskSettled = false;
      const taskPromise = Promise.resolve()
        .then(() => task(controller.signal))
        .finally(() => {
          taskSettled = true;
        });

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const error = new DeadlineExceededError(timeoutMs, `queue task ${label}`);
            controller.abort(error);
            reject(error);
          }, timeoutMs);
        });
        resolveResult(await Promise.race([taskPromise, timeout]));
      } catch (error) {
        if (error instanceof DeadlineExceededError && !taskSettled) {
          await Promise.race([
            taskPromise.then(() => undefined, () => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, this.options.cancellationGraceMs)),
          ]);
          if (!taskSettled) {
            const poison = new QueuePoisonedError(
              `task ${label} ignored cancellation; isolation boundary must be replaced before queue reuse`,
              error,
            );
            this.#poisoned = poison;
            await this.options.onUncooperativeTask?.(poison);
            rejectResult(poison);
            return;
          }
        }
        rejectResult(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    });

    return result;
  }
}
