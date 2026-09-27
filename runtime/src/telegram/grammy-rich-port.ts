import type { Api } from "grammy";
import type { InputRichMessageWithoutUpload } from "grammy/types";
import type { RichDraftRoute, RichMessagePort } from "./rich-stream.js";

export class GrammyRichMessagePort implements RichMessagePort {
  constructor(private readonly api: Api) {}

  async sendDraft(
    route: RichDraftRoute,
    draftId: number,
    richMessage: InputRichMessageWithoutUpload,
    signal?: AbortSignal,
  ): Promise<void> {
    const other = route.messageThreadId === undefined
      ? { can_stop: true, keep_on_stop: true }
      : { message_thread_id: route.messageThreadId, can_stop: true, keep_on_stop: true };
    await this.api.sendRichMessageDraft(route.chatId, draftId, richMessage, other, signal);
  }

  async sendFinal(
    route: RichDraftRoute,
    richMessage: InputRichMessageWithoutUpload,
    signal?: AbortSignal,
  ): Promise<void> {
    const other = route.messageThreadId === undefined
      ? undefined
      : { message_thread_id: route.messageThreadId };
    await this.api.sendRichMessage(route.chatId, richMessage, other, signal);
  }
}
