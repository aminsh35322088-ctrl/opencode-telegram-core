export class DeadlineExceededError extends Error {
  constructor(readonly timeoutMs: number, readonly label: string) {
    super(`${label} exceeded ${timeoutMs}ms deadline`);
    this.name = "DeadlineExceededError";
  }
}

/** Pauses budget accounting; execution checkpoints remain the caller's duty. */
export interface DeadlineActivity {
  readonly paused: boolean;
  subscribe(listener: (error?: unknown) => void): () => void;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    function done(): void {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: {
    readonly timeoutMs: number;
    readonly label: string;
    readonly parentSignal?: AbortSignal;
    readonly activity?: DeadlineActivity;
  },
): Promise<T> {
  const controller = new AbortController();
  const parent = options.parentSignal;
  parent?.throwIfAborted();
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("deadline must be positive and finite");
  const onParentAbort = (): void => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let rejectCancellation!: (reason: unknown) => void;
  const cancelled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const onAbort = (): void => rejectCancellation(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const timeout = new Promise<never>((_, reject) => {
      const expire = (): void => {
        const error = new DeadlineExceededError(options.timeoutMs, options.label);
        controller.abort(error);
        reject(error);
      };
      if (!options.activity) {
        timer = setTimeout(expire, options.timeoutMs);
        return;
      }
      let remaining = options.timeoutMs;
      let startedAt: number | undefined;
      const update = (error?: unknown): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (startedAt !== undefined) remaining -= Math.max(0, performance.now() - startedAt);
        startedAt = undefined;
        if (error !== undefined) { controller.abort(error); return; }
        if (controller.signal.aborted) return;
        if (remaining <= 0) { expire(); return; }
        if (options.activity!.paused) return;
        startedAt = performance.now();
        timer = setTimeout(expire, remaining);
      };
      try {
        unsubscribe = options.activity.subscribe(update);
        update();
      } catch (error) {
        controller.abort(error);
        reject(error);
      }
    });
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    });
    const result = await Promise.race([cancelled, timeout, work]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
    parent?.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
