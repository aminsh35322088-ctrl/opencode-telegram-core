import { abortableSleep, withDeadline } from "../runtime/deadline.js";

export interface TelegramRawTransport {
  call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T>;
}

export interface TelegramCallBudget {
  readonly requestTimeoutMs: number;
  readonly maxRetryAfterMs: number;
  readonly maxElapsedMs: number;
  readonly maxRetries: number;
}

export class TelegramApiBudgetClient {
  constructor(
    private readonly transport: TelegramRawTransport,
    private readonly budget: TelegramCallBudget,
  ) {}

  async call<T>(
    method: string,
    payload: unknown,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<T> {
    const startedAt = Date.now();
    let retries = 0;

    while (true) {
      try {
        if (method === "getUpdates") {
          return await this.transport.call<T>(method, payload, options.signal);
        }
        const deadlineOptions: {
          timeoutMs: number;
          label: string;
          parentSignal?: AbortSignal;
        } = {
          timeoutMs: this.budget.requestTimeoutMs,
          label: `Telegram ${method}`,
        };
        if (options.signal) deadlineOptions.parentSignal = options.signal;
        return await withDeadline(
          (signal) => this.transport.call<T>(method, payload, signal),
          deadlineOptions,
        );
      } catch (error) {
        const retryAfterMs = readRetryAfterMs(error);
        if (retryAfterMs === null || retries >= this.budget.maxRetries) throw error;
        const delayMs = Math.min(retryAfterMs, this.budget.maxRetryAfterMs);
        if (Date.now() - startedAt + delayMs >= this.budget.maxElapsedMs) throw error;
        retries += 1;
        await abortableSleep(delayMs, options.signal);
      }
    }
  }
}

function readRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const retryAfter = Reflect.get(error, "retry_after") ?? Reflect.get(error, "retryAfter");
  return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.floor(retryAfter * 1000)
    : null;
}
