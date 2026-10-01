import type { RichMessageButton, RichText } from "grammy/types";
import type { AgentBlock, AgentDocument } from "./agent-document.js";
import type { AgentInline } from "./agent-inline.js";

export function unicodeLength(value: string): number {
  let length = 0;
  for (const _character of value) length += 1;
  return length;
}

function isInlineArray(value: AgentInline): value is readonly AgentInline[] {
  return Array.isArray(value);
}

function isRichTextArray(value: RichText): value is RichText[] {
  return Array.isArray(value);
}

export function richTextPlainText(value: RichText): string {
  if (typeof value === "string") return value;
  if (isRichTextArray(value)) return value.map(richTextPlainText).join("");
  if (value.type === "custom_emoji") return value.alternative_text;
  if (value.type === "mathematical_expression") return value.expression;
  if (value.type === "anchor") return "";
  if (value.type === "button") return richMessageButtonPlainText(value.button);
  return "text" in value ? richTextPlainText(value.text) : "";
}

export function richMessageButtonPlainText(button: RichMessageButton): string {
  return richTextPlainText(button.text);
}

export function inlinePlainText(value: AgentInline): string {
  if (typeof value === "string") return value;
  if (isInlineArray(value)) return value.map(inlinePlainText).join("");
  if (value.type === "math") return value.expression;
  if (value.type === "custom_emoji") return value.alternativeText;
  if (value.type === "anchor") return "";
  if (value.type === "button") return richMessageButtonPlainText(value.button);
  return inlinePlainText(value.text);
}

export function inlineTelegramCharacterCount(value: AgentInline): number {
  if (typeof value === "string") return unicodeLength(value);
  if (isInlineArray(value)) {
    return value.reduce((total, part) => total + inlineTelegramCharacterCount(part), 0);
  }
  if (value.type === "directional_isolate") {
    return 2 + inlineTelegramCharacterCount(value.text);
  }
  if (value.type === "math") return unicodeLength(value.expression);
  if (value.type === "custom_emoji") return unicodeLength(value.alternativeText);
  if (value.type === "anchor") return 0;
  if (value.type === "button") return unicodeLength(richMessageButtonPlainText(value.button));
  return inlineTelegramCharacterCount(value.text);
}

function captionText(block: Extract<AgentBlock, { caption?: unknown }>): string {
  const caption = "caption" in block ? block.caption : undefined;
  if (!caption) return "";
  const credit = caption.credit === undefined ? "" : "\n" + inlinePlainText(caption.credit);
  return inlinePlainText(caption.text) + credit;
}

export function blockPlainText(block: AgentBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "code":
    case "pullquote":
    case "thinking":
    case "footer":
      return inlinePlainText(block.text);
    case "quote":
      return block.blocks && block.blocks.length > 0
        ? block.blocks.map(blockPlainText).filter(Boolean).join("\n")
        : inlinePlainText(block.text);
    case "math":
      return block.expression;
    case "divider":
    case "anchor":
      return "";
    case "buttons":
      return block.buttons.map(richMessageButtonPlainText).filter(Boolean).join(" ");
    case "list":
      return block.items.map((item) => item.blocks.map(blockPlainText).filter(Boolean).join("\n")).join("\n");
    case "table":
      return block.cells.map((row) => row.map((cell) => cell.text === undefined ? "" : inlinePlainText(cell.text)).join(" | ")).join("\n");
    case "details":
      return [inlinePlainText(block.summary), block.blocks.map(blockPlainText).filter(Boolean).join("\n")].filter(Boolean).join("\n");
    case "collage":
    case "slideshow":
      return [block.blocks.map(blockPlainText).filter(Boolean).join("\n"), captionText(block)].filter(Boolean).join("\n");
    case "photo":
    case "video":
    case "audio":
    case "animation":
    case "document":
    case "voice":
    case "voice_note":
    case "map":
      return captionText(block);
  }
}

export function documentPlainText(document: AgentDocument): string {
  return document.blocks.map(blockPlainText).filter(Boolean).join("\n\n");
}

export function documentCharacterCount(document: AgentDocument): number {
  return unicodeLength(documentPlainText(document));
}
