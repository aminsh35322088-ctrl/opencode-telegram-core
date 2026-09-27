import { Api } from "grammy";
import type { TelegramRawTransport } from "./api-budget.js";

type RawCall = (payload: unknown, signal?: AbortSignal) => Promise<unknown>;

export class GrammyTelegramTransport implements TelegramRawTransport {
  readonly api: Api;

  constructor(token: string) {
    this.api = new Api(token);
  }

  call<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    const raw = this.api.raw as unknown as Record<string, RawCall | undefined>;
    const fn = raw[method];
    if (typeof fn !== "function") {
      throw new Error("Unsupported Telegram Bot API method: " + method);
    }
    return fn.call(this.api.raw, payload, signal) as Promise<T>;
  }
}
