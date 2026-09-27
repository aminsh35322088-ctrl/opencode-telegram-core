import { streamApi } from "@grammyjs/stream";
import type { Api } from "grammy";
import type { RichDraftRoute } from "./rich-stream.js";

export interface NativeMarkdownStreamPort {
  streamMarkdown(
    route: RichDraftRoute,
    draftId: number,
    chunks: AsyncIterable<string> | Iterable<string>,
    signal?: AbortSignal,
  ): Promise<void>;
}

export class GrammyNativeMarkdownStreamPort implements NativeMarkdownStreamPort {
  readonly #stream: ReturnType<typeof streamApi>;

  constructor(api: Api) {
    this.#stream = streamApi(api.raw);
  }

  async streamMarkdown(
    route: RichDraftRoute,
    draftId: number,
    chunks: AsyncIterable<string> | Iterable<string>,
    signal?: AbortSignal,
  ): Promise<void> {
    const thread = route.messageThreadId === undefined
      ? {}
      : { message_thread_id: route.messageThreadId };

    await this.#stream.streamMarkdown(
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
      signal,
    );
  }
}
