import type { RichMessageButton, User } from "grammy/types";

export type AgentDateTimeFormat =
  | "r" | "" | "w" | "d" | "D" | "t" | "T"
  | "wd" | "wD" | "wt" | "wT"
  | "dt" | "dT" | "Dt" | "DT"
  | "wdt" | "wdT" | "wDt" | "wDT";

/** Semantic inline rich text mirroring Telegram Bot API RichText. */
export type AgentInline =
  | string
  | readonly AgentInline[]
  | { readonly type: "bold"; readonly text: AgentInline }
  | { readonly type: "italic"; readonly text: AgentInline }
  | { readonly type: "underline"; readonly text: AgentInline }
  | { readonly type: "strikethrough"; readonly text: AgentInline }
  | { readonly type: "spoiler"; readonly text: AgentInline }
  | { readonly type: "subscript"; readonly text: AgentInline }
  | { readonly type: "superscript"; readonly text: AgentInline }
  | { readonly type: "marked"; readonly text: AgentInline }
  | { readonly type: "code"; readonly text: AgentInline }
  | { readonly type: "directional_isolate"; readonly direction: "ltr" | "rtl" | "auto"; readonly text: AgentInline }
  | { readonly type: "math"; readonly expression: string }
  | { readonly type: "date_time"; readonly text: AgentInline; readonly unixTime: number; readonly format: AgentDateTimeFormat }
  | { readonly type: "url"; readonly text: AgentInline; readonly url: string }
  | { readonly type: "telegram_user_link"; readonly text: AgentInline; readonly userId: string }
  | { readonly type: "email"; readonly text: AgentInline; readonly email: string }
  | { readonly type: "phone"; readonly text: AgentInline; readonly phone: string }
  | { readonly type: "bank_card"; readonly text: AgentInline; readonly bankCard: string }
  | { readonly type: "mention"; readonly text: AgentInline; readonly username: string }
  | { readonly type: "text_mention"; readonly text: AgentInline; readonly user: User }
  | { readonly type: "hashtag"; readonly text: AgentInline; readonly hashtag: string }
  | { readonly type: "cashtag"; readonly text: AgentInline; readonly cashtag: string }
  | { readonly type: "bot_command"; readonly text: AgentInline; readonly botCommand: string }
  | { readonly type: "anchor"; readonly name: string }
  | { readonly type: "anchor_link"; readonly text: AgentInline; readonly anchorName: string }
  | { readonly type: "reference"; readonly text: AgentInline; readonly name: string }
  | { readonly type: "reference_link"; readonly text: AgentInline; readonly referenceName: string }
  | { readonly type: "button"; readonly button: RichMessageButton }
  | { readonly type: "custom_emoji"; readonly customEmojiId: string; readonly alternativeText: string };
