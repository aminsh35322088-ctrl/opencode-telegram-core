import { withDeadline, type DeadlineActivity } from "./deadline.js";

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
    activity?: DeadlineActivity,
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
      let taskSettled = true;
      let taskPromise: Promise<unknown> = Promise.resolve();

      try {
        resolveResult(await withDeadline(() => {
          taskSettled = false;
          const started = (async () => task(controller.signal))().finally(() => { taskSettled = true; });
          taskPromise = started;
          return started;
        }, {
          timeoutMs, label: `queue task ${label}`, parentSignal: controller.signal,
          ...(activity ? { activity } : {}),
        }));
      } catch (error) {
        controller.abort(error);
        if (!taskSettled) {
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
            // The handler only reports that the isolation boundary failed.
            // Settle the caller before reporting the isolation failure. The
            // reporter is best-effort and may itself throw or hang forever; it
            // must never hold the poisoned queue tail or the caller hostage.
            rejectResult(poison);
            void Promise.resolve()
              .then(() => this.options.onUncooperativeTask?.(poison))
              .catch(() => undefined);
            return;
          }
        }
        rejectResult(error);
      }
    });

    return result;
  }
}
