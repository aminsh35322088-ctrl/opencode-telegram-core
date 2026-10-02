import type { InputRichMessageWithoutUpload, RichMessageButton } from "grammy/types";
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
type ParagraphBlock = Extract<DraftBlock, { type: "paragraph" }>;
type RichText = ParagraphBlock["text"];
type RichBlockCaption = NonNullable<Extract<DraftBlock, { type: "photo" }>["caption"]>;
type RichListItem = Extract<DraftBlock, { type: "list" }>["items"][number];
type RichTableCell = Extract<DraftBlock, { type: "table" }>["cells"][number][number];

function isInlineArray(value: AgentInline): value is readonly AgentInline[] {
  return Array.isArray(value);
}

function isSafeRichUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === "mailto:" ||
      url.protocol === "tel:";
  } catch {
    return false;
  }
}

export function compileInline(value: AgentInline): RichText {
  if (typeof value === "string") return value;
  if (isInlineArray(value)) return value.map(compileInline) as RichText;
  switch (value.type) {
    case "directional_isolate": {
      const start = value.direction === "ltr"
        ? "⁦"
        : value.direction === "rtl"
          ? "⁧"
          : "⁨";
      return [start, compileInline(value.text), "⁩"] as RichText;
    }
    case "math":
      return { type: "mathematical_expression", expression: value.expression };
    case "date_time":
      return { type: "date_time", text: compileInline(value.text), unix_time: value.unixTime, date_time_format: value.format };
    case "url":
      return isSafeRichUrl(value.url) ? { type: "url", text: compileInline(value.text), url: value.url } : compileInline(value.text);
    case "telegram_user_link":
      return /^\d+$/.test(value.userId)
        ? { type: "url", text: compileInline(value.text), url: "tg://user?id=" + value.userId }
        : compileInline(value.text);
    case "email":
      return { type: "email_address", text: compileInline(value.text), email_address: value.email };
    case "phone":
      return { type: "phone_number", text: compileInline(value.text), phone_number: value.phone };
    case "bank_card":
      return { type: "bank_card_number", text: compileInline(value.text), bank_card_number: value.bankCard };
    case "mention":
      return { type: "mention", text: compileInline(value.text), username: value.username };
    case "text_mention":
      return { type: "text_mention", text: compileInline(value.text), user: value.user };
    case "hashtag":
      return { type: "hashtag", text: compileInline(value.text), hashtag: value.hashtag };
    case "cashtag":
      return { type: "cashtag", text: compileInline(value.text), cashtag: value.cashtag };
    case "bot_command":
      return { type: "bot_command", text: compileInline(value.text), bot_command: value.botCommand };
    case "anchor":
      return { type: "anchor", name: value.name };
    case "anchor_link":
      return { type: "anchor_link", text: compileInline(value.text), anchor_name: value.anchorName };
    case "reference":
      return { type: "reference", text: compileInline(value.text), name: value.name };
    case "reference_link":
      return { type: "reference_link", text: compileInline(value.text), reference_name: value.referenceName };
    case "button":
      return { type: "button", button: value.button };
    case "custom_emoji":
      return { type: "custom_emoji", custom_emoji_id: value.customEmojiId, alternative_text: value.alternativeText };
    default:
      return { type: value.type, text: compileInline(value.text) } as RichText;
  }
}

function compileMediaRef(ref: AgentMediaRef): string {
  if (ref.kind === "file_id") return ref.fileId;
  try {
    const url = new URL(ref.url);
    if (url.protocol === "https:") return ref.url;
  } catch {}
  throw new Error("rich media reference must be a file_id or an https:// URL");
}

function compileCaption(caption: AgentCaption | undefined): RichBlockCaption | undefined {
  if (!caption) return undefined;
  return {
    text: compileInline(caption.text),
    ...(caption.credit !== undefined ? { credit: compileInline(caption.credit) } : {}),
  };
}

function compileListItem(item: AgentListItem, allowThinking: boolean): RichListItem {
  return {
    blocks: item.blocks.map((block) => compileBlock(block, allowThinking)).filter(isBlock),
    ...(item.marker !== undefined ? { type: item.marker } : {}),
    ...(item.hasCheckbox ? { has_checkbox: true } : {}),
    ...(item.isChecked ? { is_checked: true } : {}),
    ...(item.value !== undefined ? { value: item.value } : {}),
  };
}

function compileCell(cell: AgentTableCell): RichTableCell {
  return {
    align: cell.align ?? "left",
    valign: cell.valign ?? "top",
    ...(cell.text !== undefined ? { text: compileInline(cell.text) } : {}),
    ...(cell.isHeader ? { is_header: true } : {}),
    ...(cell.colspan !== undefined ? { colspan: cell.colspan } : {}),
    ...(cell.rowspan !== undefined ? { rowspan: cell.rowspan } : {}),
  };
}

function isBlock(value: DraftBlock | null): value is DraftBlock {
  return value !== null;
}

function compileButtons(buttons: readonly RichMessageButton[]): RichMessageButton[] {
  return buttons.slice(0, 8).map((button) => ({ ...button }));
}

function compileBlock(block: AgentBlock, allowThinking: boolean): DraftBlock | null {
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", text: compileInline(block.text) };
    case "heading":
      return { type: "heading", text: compileInline(block.text), size: block.level };
    case "code": {
      const result: DraftBlock = { type: "pre", text: compileInline(block.text) };
      if (block.language) (result as { language?: string }).language = block.language;
      return result;
    }
    case "quote": {
      const credit = block.credit === undefined ? {} : { credit: compileInline(block.credit) };
      if (block.expandable) return { type: "expandable_blockquote", text: compileInline(block.text), ...credit } as DraftBlock;
      return {
        type: "blockquote",
        blocks: block.blocks
          ? block.blocks.map((inner) => compileBlock(inner, allowThinking)).filter(isBlock)
          : [{ type: "paragraph", text: compileInline(block.text) }],
        ...credit,
      } as DraftBlock;
    }
    case "pullquote":
      return { type: "pullquote", text: compileInline(block.text), ...(block.credit !== undefined ? { credit: compileInline(block.credit) } : {}) } as DraftBlock;
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
    case "buttons":
      return { type: "buttons", buttons: compileButtons(block.buttons), ...(block.align ? { align: block.align } : {}) } as DraftBlock;
    case "list":
      return { type: "list", items: block.items.map((item) => compileListItem(item, allowThinking)) };
    case "table":
      return {
        type: "table",
        cells: block.cells.map((row) => row.map(compileCell)),
        ...(block.isBordered ? { is_bordered: true } : {}),
        ...(block.isStriped ? { is_striped: true } : {}),
        ...(block.isCompact ? { is_compact: true } : {}),
        ...(block.caption ? { caption: compileInline(block.caption.text) } : {}),
      };
    case "details":
      return { type: "details", summary: compileInline(block.summary), blocks: block.blocks.map((inner) => compileBlock(inner, allowThinking)).filter(isBlock), ...(block.isOpen ? { is_open: true } : {}) } as DraftBlock;
    case "collage":
    case "slideshow":
      return { type: block.type, blocks: block.blocks.map((inner) => compileBlock(inner, allowThinking)).filter(isBlock), ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
    case "photo":
      return { type: "photo", photo: { type: "photo", media: compileMediaRef(block.media), ...(block.spoiler ? { has_spoiler: true } : {}) }, ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
    case "video":
      return { type: "video", video: { type: "video", media: compileMediaRef(block.media), ...(block.spoiler ? { has_spoiler: true } : {}) }, ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
    case "audio":
      return { type: "audio", audio: { type: "audio", media: compileMediaRef(block.media) }, ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
    case "animation":
      return { type: "animation", animation: { type: "animation", media: compileMediaRef(block.media), ...(block.spoiler ? { has_spoiler: true } : {}) }, ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
    case "document":
      return { type: "document", document: { type: "document", media: compileMediaRef(block.media) }, ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
    case "voice":
    case "voice_note":
      return { type: "voice_note", voice_note: { type: "voice_note", media: compileMediaRef(block.media) }, ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
    case "map":
      return { type: "map", location: { latitude: block.latitude, longitude: block.longitude }, ...(block.zoom !== undefined ? { zoom: block.zoom } : {}), ...(block.width !== undefined ? { width: block.width } : {}), ...(block.height !== undefined ? { height: block.height } : {}), ...(block.caption ? { caption: compileCaption(block.caption) } : {}) } as DraftBlock;
  }
}

export function renderTelegramRichDocument(
  document: AgentDocument,
  options: { readonly draft: boolean },
): InputRichMessageWithoutUpload {
  const blocks = document.blocks.map((block) => compileBlock(block, options.draft)).filter(isBlock);
  const result: InputRichMessageWithoutUpload = { blocks };
  if (document.rtl !== undefined) result.is_rtl = document.rtl;
  return result;
}

export function renderTelegramRichMarkdown(
  markdown: string,
  options: { readonly rtl?: boolean; readonly skipEntityDetection?: boolean } = {},
): InputRichMessageWithoutUpload {
  const result: InputRichMessageWithoutUpload = { markdown };
  if (options.rtl !== undefined) result.is_rtl = options.rtl;
  if (options.skipEntityDetection !== undefined) result.skip_entity_detection = options.skipEntityDetection;
  return result;
}
