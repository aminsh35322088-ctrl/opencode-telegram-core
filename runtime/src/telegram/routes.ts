export type TelegramRoute =
  | TelegramChatRoute
  | TelegramTopicRoute
  | TelegramDirectMessagesRoute
  | TelegramBusinessRoute
  | TelegramInlineRoute
  | TelegramGuestRoute;

export interface TelegramChatRoute {
  readonly kind: "chat";
  readonly botId: string;
  readonly chatId: number;
}

export interface TelegramTopicRoute {
  readonly kind: "topic";
  readonly botId: string;
  readonly chatId: number;
  readonly threadId: number;
}

export interface TelegramDirectMessagesRoute {
  readonly kind: "direct_messages_topic";
  readonly botId: string;
  readonly chatId: number;
  readonly directMessagesTopicId: number;
}

export interface TelegramBusinessRoute {
  readonly kind: "business";
  readonly botId: string;
  readonly businessConnectionId: string;
  readonly chatId: number;
  readonly threadId?: number;
}

export interface TelegramInlineRoute {
  readonly kind: "inline";
  readonly botId: string;
  readonly userId: number;
  readonly inlineQueryId: string;
}

export interface TelegramGuestRoute {
  readonly kind: "guest";
  readonly botId: string;
  readonly guestQueryId: string;
  readonly chatId?: number;
}

export function telegramRouteKey(route: TelegramRoute): string {
  switch (route.kind) {
    case "chat":
      return route.botId + ":chat:" + route.chatId;
    case "topic":
      return route.botId + ":topic:" + route.chatId + ":" + route.threadId;
    case "direct_messages_topic":
      return route.botId + ":direct:" + route.chatId + ":" + route.directMessagesTopicId;
    case "business":
      return route.botId + ":business:" + route.businessConnectionId + ":" + route.chatId + ":" + (route.threadId ?? 0);
    case "inline":
      return route.botId + ":inline:" + route.userId + ":" + route.inlineQueryId;
    case "guest":
      return route.botId + ":guest:" + route.guestQueryId + ":" + (route.chatId ?? 0);
  }
}

export type AdmissionDecision = "MODEL_ALLOWED" | "CONTROL_ONLY" | "REJECT";

export interface TelegramAdmissionContext {
  readonly route: TelegramRoute;
  readonly operation: string;
}

export type TelegramAdmissionPolicy = (
  context: TelegramAdmissionContext,
) => AdmissionDecision | Promise<AdmissionDecision>;

export async function requireModelAdmission(
  policy: TelegramAdmissionPolicy,
  context: TelegramAdmissionContext,
): Promise<boolean> {
  return await policy(context) === "MODEL_ALLOWED";
}
