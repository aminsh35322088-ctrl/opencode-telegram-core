import type { InputRichMessageWithoutUpload } from "grammy/types";
import type { AgentInline } from "./agent-inline.js";
import type { AgentBlock, AgentDocument } from "./agent-document.js";

type DraftBlock = NonNullable<InputRichMessageWithoutUpload["blocks"]>[number];
// InputRichMessage itself has no `text` field: the inline tree lives on each
// block. Deriving it from a real block keeps this correct if grammy renames it.
type ParagraphBlock = Extract<DraftBlock, { type: "paragraph" }>;
type RichText = ParagraphBlock["text"];

/** `Array.isArray` does not narrow a readonly array, so guard it explicitly. */
function isInlineArray(value: AgentInline): value is readonly AgentInline[] {
  return Array.isArray(value);
}

function compileBlock(block: AgentBlock, allowThinking: boolean): DraftBlock | null {
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", text: compileInline(block.text) };
    case "heading":
      return { type: "heading", text: compileInline(block.text), size: block.level };
    case "code": {
      const result: DraftBlock = { type: "pre", text: compileInline(block.text) };
      if (block.language) {
        (result as { language?: string }).language = block.language;
      }
      return result;
    }
    case "quote":
      return block.expandable
        ? { type: "expandable_blockquote", text: compileInline(block.text) }
        : { type: "blockquote", blocks: [{ type: "paragraph", text: compileInline(block.text) }] };
    case "math":
      return { type: "mathematical_expression", expression: block.expression };
    case "divider":
      return { type: "divider" };
    case "thinking":
      return allowThinking ? { type: "thinking", text: compileInline(block.text) } : null;
  }
}

/**
 * Compiles the inline tree into the Bot API `RichText` shape, which is the
 * same recursive union: a bare string, an array of values, or a typed node.
 * A string is passed through so plain text stays plain instead of being
 * wrapped in a no-op node.
 */
export function compileInline(value: AgentInline): RichText {
  if (typeof value === "string") return value;
  if (isInlineArray(value)) return value.map(compileInline) as RichText;
  switch (value.type) {
    case "math":
      return { type: "mathematical_expression", expression: value.expression };
    case "url":
      return { type: "url", text: compileInline(value.text), url: value.url };
    case "email":
      return { type: "email_address", text: compileInline(value.text), email_address: value.email };
    case "phone":
      return { type: "phone_number", text: compileInline(value.text), phone_number: value.phone };
    case "mention":
      return { type: "mention", text: compileInline(value.text), user_id: value.userId };
    case "text_mention":
      return {
        type: "text_mention",
        text: compileInline(value.text),
        user_id: value.userId,
      };
    case "custom_emoji":
      return {
        type: "custom_emoji",
        custom_emoji_id: value.customEmojiId,
        text: value.fallback,
      };
    default:
      return { type: value.type, text: compileInline(value.text) } as RichText;
  }
}

export function renderTelegramRichDocument(
  document: AgentDocument,
  options: { readonly draft: boolean },
): InputRichMessageWithoutUpload {
  const blocks = document.blocks
    .map((block) => compileBlock(block, options.draft))
    .filter((block): block is DraftBlock => block !== null);

  const result: InputRichMessageWithoutUpload = { blocks };
  if (document.rtl !== undefined) result.is_rtl = document.rtl;
  return result;
}

export function renderTelegramRichMarkdown(
  markdown: string,
  options: {
    readonly rtl?: boolean;
    readonly skipEntityDetection?: boolean;
  } = {},
): InputRichMessageWithoutUpload {
  const result: InputRichMessageWithoutUpload = { markdown };
  if (options.rtl !== undefined) result.is_rtl = options.rtl;
  if (options.skipEntityDetection !== undefined) {
    result.skip_entity_detection = options.skipEntityDetection;
  }
  return result;
}
