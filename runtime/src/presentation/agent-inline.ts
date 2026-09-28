/**
 * Inline rich text, mirroring the Bot API `RichText` tree.
 *
 * Telegram models inline formatting as a recursive value: a bare string, a
 * concatenation of values, or one of the typed nodes below, each of which
 * nests further values. A plain `string` is always valid, so a caller that
 * only needs unformatted text keeps working unchanged.
 *
 * The node set is the subset a bot may *send*; the remaining `RichText*`
 * variants Telegram only produces (references, bank cards, date times,
 * mentions, hashtags, cashtags, bot commands, buttons) are not authorable.
 */
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
  | { readonly type: "math"; readonly expression: string }
  | { readonly type: "url"; readonly text: AgentInline; readonly url: string }
  | { readonly type: "email"; readonly text: AgentInline; readonly email: string }
  | { readonly type: "phone"; readonly text: AgentInline; readonly phone: string }
  | { readonly type: "mention"; readonly text: AgentInline; readonly userId: number }
  | { readonly type: "text_mention"; readonly text: AgentInline; readonly userId: number }
  | { readonly type: "custom_emoji"; readonly customEmojiId: string; readonly fallback: string };
