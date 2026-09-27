export class DeadlineExceededError extends Error {
  constructor(readonly timeoutMs: number, readonly label: string) {
    super(`${label} exceeded ${timeoutMs}ms deadline`);
    this.name = "DeadlineExceededError";
  }
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
  },
): Promise<T> {
  const controller = new AbortController();
  const parent = options.parentSignal;
  const onParentAbort = (): void => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new DeadlineExceededError(options.timeoutMs, options.label);
        controller.abort(error);
        reject(error);
      }, options.timeoutMs);
    });
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}
