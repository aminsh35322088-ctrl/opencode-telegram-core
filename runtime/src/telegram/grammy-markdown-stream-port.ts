import { streamApi } from "@grammyjs/stream";
import type { Api } from "grammy";
import {
  RichStreamFencedError,
  type NativeMarkdownStreamPort,
  type RichDraftRoute,
} from "./rich-stream.js";

type StreamRawApi = Parameters<typeof streamApi>[0];

export class GrammyNativeMarkdownStreamPort implements NativeMarkdownStreamPort {
  constructor(private readonly api: Api) {}

  async streamMarkdown(
    route: RichDraftRoute,
    draftId: number,
    chunks: AsyncIterable<string> | Iterable<string>,
    options: {
      readonly signal: AbortSignal;
      readonly guard: () => boolean;
    },
  ): Promise<void> {
    const thread = route.messageThreadId === undefined
      ? {}
      : { message_thread_id: route.messageThreadId };

    const raw = this.api.raw;
    const guardedRaw = new Proxy(raw, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;

        if (property === "sendRichMessageDraft" || property === "sendRichMessage") {
          return (...args: unknown[]) => {
            if (!options.guard()) throw new RichStreamFencedError();
            return Reflect.apply(value, target, args);
          };
        }
        return value.bind(target);
      },
    }) as StreamRawApi;

    const stream = streamApi(guardedRaw);
    await stream.streamMarkdown(
      route.chatId,
      draftId,
      chunks,
      {
        ...thread,
        can_stop: true,
        keep_on_stop: true,
      },
      thread,
      undefined,
      options.signal as Parameters<typeof stream.streamMarkdown>[6],
    );
  }
}
