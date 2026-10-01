import { streamApi } from "@grammyjs/stream";
import type { Api } from "grammy";
import { detectMarkdownDirection } from "../presentation/agent-document-bidi.js";
import {
  RichStreamFencedError,
  type NativeMarkdownStreamPort,
  type RichDraftRoute,
} from "./rich-stream.js";

type StreamRawApi = Parameters<typeof streamApi>[0];

function withDetectedRtl(args: readonly unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (first === null || typeof first !== "object" || Array.isArray(first)) return [...args];

  const payload = first as Record<string, unknown>;
  const richMessage = payload.rich_message;
  if (richMessage === null || typeof richMessage !== "object" || Array.isArray(richMessage)) {
    return [...args];
  }

  const rich = richMessage as Record<string, unknown>;
  if (
    typeof rich.markdown !== "string" ||
    rich.is_rtl !== undefined ||
    detectMarkdownDirection(rich.markdown) !== "rtl"
  ) {
    return [...args];
  }

  return [
    {
      ...payload,
      rich_message: {
        ...rich,
        is_rtl: true,
      },
    },
    ...rest,
  ];
}

export class GrammyNativeMarkdownStreamPort implements NativeMarkdownStreamPort {
  constructor(private readonly api: Api) {}

  async streamMarkdown(
    route: RichDraftRoute,
    draftId: number,
    chunks: AsyncIterable<string> | Iterable<string>,
    options: {
      readonly signal: AbortSignal;
      readonly guard: () => boolean;
      readonly withMutation?: <T>(operation: () => Promise<T>) => Promise<T>;
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
          return async (...args: unknown[]) => {
            const mutate = async () => {
              options.signal.throwIfAborted();
              if (!options.guard()) throw new RichStreamFencedError();
              return Reflect.apply(value, target, withDetectedRtl(args));
            };
            return options.withMutation ? options.withMutation(mutate) : mutate();
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
