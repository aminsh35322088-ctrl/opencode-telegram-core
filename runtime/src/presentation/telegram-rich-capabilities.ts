export const TELEGRAM_RICH_PRESENTATION_CAPABILITIES = {
  richMessages: true,
  details: true,
  expandableQuotes: true,
  math: true,
  dateTime: true,
  anchors: true,
  references: true,
  compactTables: true,
  richButtons: true,
  rtlBidi: true,
} as const;

export type TelegramRichPresentationCapability =
  keyof typeof TELEGRAM_RICH_PRESENTATION_CAPABILITIES;
