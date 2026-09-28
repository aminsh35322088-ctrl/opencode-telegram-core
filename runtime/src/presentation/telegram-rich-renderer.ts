import type { InputRichMessageWithoutUpload } from "grammy/types";
import type { AgentInline } from "./agent-inline.js";
import type {
  AgentBlock,
  AgentCaption,
  AgentDocument,
  AgentListItem,
  AgentMediaRef,
  AgentTableCell,
} from "./agent-document.js";

type DraftBlock = NonNullable<InputRichMessageWithoutUpload["blocks"]>[number];
// InputRichMessage itself has no `text` field: the inline tree lives on each
// block. Deriving it from a real block keeps this correct if grammy renames it.
type ParagraphBlock = Extract<DraftBlock, { type: "paragraph" }>;
type RichText = ParagraphBlock["text"];

/** `Array.isArray` does not narrow a readonly array, so guard it explicitly. */
function isInlineArray(value: AgentInline): value is readonly AgentInline[] {
  return Array.isArray(value);
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
      return { type: "text_mention", text: compileInline(value.text), user_id: value.userId };
    case "custom_emoji":
      return { type: "custom_emoji", custom_emoji_id: value.customEmojiId, text: value.fallback };
    default:
      return { type: value.type, text: compileInline(value.text) } as RichText;
  }
}

/**
 * Media is referenced, never uploaded: the core holds no bytes and Telegram
 * fetches the content itself from a `file_id` or an `https://` URL.
 */
function compileMedia(ref: AgentMediaRef): string {
  if (ref.kind === "file_id") return ref.fileId;
  if (!ref.url.startsWith("https://") && !ref.url.startsWith("tg://")) {
    throw new Error("rich media reference must be a file_id or an https:// or tg:// URL");
  }
  return ref.url;
}

function compileCaption(caption: AgentCaption | undefined): RichText | undefined {
  return caption ? compileInline(caption.text) : undefined;
}

function compileListItem(item: AgentListItem): Record<string, unknown> {
  const result: Record<string, unknown> = {
    blocks: item.blocks.map((block) => compileBlock(block, true)).filter(isBlock),
  };
  if (item.marker !== undefined) result.type = item.marker;
  if (item.hasCheckbox) result.has_checkbox = true;
  if (item.isChecked) result.is_checked = true;
  if (item.value !== undefined) result.value = item.value;
  return result;
}

function compileCell(cell: AgentTableCell): Record<string, unknown> {
  const result: Record<string, unknown> = {
    align: cell.align ?? "left",
    valign: cell.valign ?? "top",
  };
  if (cell.text !== undefined) result.text = compileInline(cell.text);
  if (cell.isHeader) result.is_header = true;
  if (cell.colspan !== undefined) result.colspan = cell.colspan;
  if (cell.rowspan !== undefined) result.rowspan = cell.rowspan;
  return result;
}

function isBlock(value: DraftBlock | null): value is DraftBlock {
  return value !== null;
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
    case "pullquote": {
      const result: Record<string, unknown> = {
        type: "pullquote",
        text: compileInline(block.text),
      };
      if (block.credit !== undefined) result.credit = compileInline(block.credit);
      return result as DraftBlock;
    }
    case "math":
      return { type: "mathematical_expression", expression: block.expression };
    case "divider":
      return { type: "divider" };
    case "thinking":
      return allowThinking ? { type: "thinking", text: compileInline(block.text) } : null;
    case "footer":
      return { type: "footer", text: compileInline(block.text) };
    case "anchor":
      return { type: "anchor", name: block.name };
    case "list":
      return { type: "list", items: block.items.map(compileListItem) } as DraftBlock;
    case "table": {
      const result: Record<string, unknown> = {
        type: "table",
        cells: block.cells.map((row) => row.map(compileCell)),
      };
      if (block.isBordered) result.is_bordered = true;
      if (block.isStriped) result.is_striped = true;
      if (block.isCompact) result.is_compact = true;
      if (block.caption) result.caption = compileCaption(block.caption);
      return result as DraftBlock;
    }
    case "details": {
      const result: Record<string, unknown> = {
        type: "details",
        summary: compileInline(block.summary),
        blocks: block.blocks.map((inner) => compileBlock(inner, allowThinking)).filter(isBlock),
      };
      if (block.isOpen) result.is_open = true;
      return result as DraftBlock;
    }
    case "collage":
    case "slideshow":
      return {
        type: block.type,
        blocks: block.blocks.map((inner) => compileBlock(inner, allowThinking)).filter(isBlock),
        ...(block.caption ? { caption: compileCaption(block.caption) } : {}),
      } as DraftBlock;
    case "photo":
    case "video":
    case "audio":
    case "voice":
    case "animation":
    case "document": {
      const ref = block[block.type];
      return {
        type: block.type,
        [block.type]: compileMedia(ref),
        ...(block.caption ? { caption: compileCaption(block.caption) } : {}),
      } as DraftBlock;
    }
    case "map": {
      const result: Record<string, unknown> = {
        type: "map",
        location: { latitude: block.latitude, longitude: block.longitude },
        zoom: block.zoom,
        width: block.width,
        height: block.height,
      };
      if (block.caption) result.caption = compileCaption(block.caption);
      return result as DraftBlock;
    }
  }
}

export function renderTelegramRichDocument(
  document: AgentDocument,
  options: { readonly draft: boolean },
): InputRichMessageWithoutUpload {
  const blocks = document.blocks
    .map((block) => compileBlock(block, options.draft))
    .filter(isBlock);

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
