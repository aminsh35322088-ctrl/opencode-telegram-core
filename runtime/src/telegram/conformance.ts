export const TELEGRAM_CONFORMANCE = Object.freeze({
  botApiVersion: "10.3",
  grammyVersion: "1.46.0",
  nativeRichMessages: true,
  nativeRichDraftStreaming: true,
  guestMode: true,
  managedBots: true,
  directMessagesTopics: true,
  businessConnections: true,
  rawApiPassthrough: true,
} as const);

export type TelegramConformance = typeof TELEGRAM_CONFORMANCE;
