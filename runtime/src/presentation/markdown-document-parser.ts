import { parseFragment } from "parse5";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import type { RichMessageButton, RichText } from "grammy/types";
import type {
  AgentBlock,
  AgentCaption,
  AgentDocument,
  AgentListItem,
  AgentMediaRef,
  AgentTableCell,
} from "./agent-document.js";
import type { AgentDateTimeFormat, AgentInline } from "./agent-inline.js";

type MdAlign = "left" | "center" | "right" | null;

interface MdNode {
  readonly type: string;
  readonly value?: string;
  readonly url?: string;
  readonly alt?: string | null;
  readonly title?: string | null;
  readonly lang?: string | null;
  readonly depth?: number;
  readonly ordered?: boolean | null;
  readonly start?: number | null;
  readonly checked?: boolean | null;
  readonly identifier?: string;
  readonly align?: readonly MdAlign[];
  readonly children?: readonly MdNode[];
  readonly position?: {
    readonly start?: { readonly offset?: number };
    readonly end?: { readonly offset?: number };
  };
}

export interface ParseMarkdownDocumentOptions {
  readonly rtl?: boolean;
  readonly allowInteractiveButtons?: boolean;
  readonly allowTelegramUserLinks?: boolean;
  readonly richMedia?: Readonly<Record<string, AgentMediaRef>>;
}

interface ParseContext {
  readonly source: string;
  readonly options: ParseMarkdownDocumentOptions;
  readonly footnotes: Map<string, number>;
  readonly references: Set<string>;
  nextFootnote: number;
}

interface HtmlTag {
  readonly name: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attrs: Readonly<Record<string, string | true>>;
  readonly raw: string;
}

interface InlineFrame {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string | true>>;
  readonly rawOpen: string;
  readonly content: AgentInline[];
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const GROUPABLE_TAGS = new Set([
  "details",
  "tg-collage",
  "tg-slideshow",
  "blockquote",
  "aside",
  "figure",
  "table",
  "ul",
  "ol",
  "pre",
  "p",
  "footer",
  "tg-button-row",
]);

function isInlineArray(value: AgentInline): value is readonly AgentInline[] {
  return Array.isArray(value);
}

function concatInline(parts: readonly AgentInline[]): AgentInline {
  const out: AgentInline[] = [];
  const append = (value: AgentInline): void => {
    if (isInlineArray(value)) {
      for (const nested of value) append(nested);
      return;
    }
    const previous = out.at(-1);
    if (typeof previous === "string" && typeof value === "string") {
      out[out.length - 1] = previous + value;
    } else if (typeof value !== "string" || value.length > 0) {
      out.push(value);
    }
  };
  for (const part of parts) append(part);
  if (out.length === 0) return "";
  return out.length === 1 ? out[0]! : out;
}

function inlinePlain(value: AgentInline): string {
  if (typeof value === "string") return value;
  if (isInlineArray(value)) return value.map(inlinePlain).join("");
  if (value.type === "math") return value.expression;
  if (value.type === "custom_emoji") return value.alternativeText;
  if (value.type === "anchor") return "";
  if (value.type === "button") return richTextPlain(value.button.text);
  return inlinePlain(value.text);
}

function richTextPlain(value: RichText): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(richTextPlain).join("");
  if (value.type === "custom_emoji") return value.alternative_text;
  if (value.type === "mathematical_expression") return value.expression;
  if (value.type === "anchor") return "";
  if (value.type === "button") return richTextPlain(value.button.text);
  return "text" in value ? richTextPlain(value.text) : "";
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    quot: '"',
    apos: "'",
    amp: "&",
    lt: "<",
    gt: ">",
    nbsp: "\u00a0",
    hellip: "…",
    mdash: "—",
    ndash: "–",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, entity: string) => named[entity.toLowerCase()] ?? match);
}

function parseHtmlTag(raw: string): HtmlTag | null {
  const match = raw.trim().match(/^<\s*(\/)?\s*([A-Za-z][A-Za-z0-9-]*)([\s\S]*?)>$/);
  if (!match) return null;
  const closing = Boolean(match[1]);
  const name = match[2]!.toLowerCase();
  if (closing) return { name, closing: true, selfClosing: false, attrs: {}, raw };

  let tail = match[3] ?? "";
  const selfClosing = /\/\s*$/.test(tail);
  if (selfClosing) tail = tail.replace(/\/\s*$/, "");
  const attrs: Record<string, string | true> = {};
  const attrPattern = /([:@A-Za-z_][:@A-Za-z0-9_.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  let attr: RegExpExecArray | null;
  while ((attr = attrPattern.exec(tail)) !== null) {
    const key = attr[1]!.toLowerCase();
    const rawValue = attr[2] ?? attr[3] ?? attr[4];
    attrs[key] = rawValue === undefined ? true : decodeHtml(rawValue);
  }
  return { name, closing: false, selfClosing, attrs, raw };
}

function integerAttr(attrs: Readonly<Record<string, string | true>>, name: string): number | undefined {
  const raw = attrs[name];
  if (typeof raw !== "string") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : undefined;
}

function floatAttr(attrs: Readonly<Record<string, string | true>>, name: string): number | undefined {
  const raw = attrs[name];
  if (typeof raw !== "string") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function dateTimeFormat(value: string | true | undefined): AgentDateTimeFormat | null {
  const raw = value === undefined || value === true ? "" : value;
  return /^(?:r|w?[dD]?[tT]?)$/.test(raw) ? raw as AgentDateTimeFormat : null;
}

function safeExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (["https:", "http:", "mailto:", "tel:"].includes(url.protocol)) return raw;
  } catch {}
  return null;
}

function safeTrustedButtonUrl(raw: string): string | null {
  const external = safeExternalUrl(raw);
  if (external) return external;
  try {
    const url = new URL(raw);
    return url.protocol === "tg:" &&
      url.hostname === "user" &&
      /^\d+$/.test(url.searchParams.get("id") ?? "")
      ? raw
      : null;
  } catch {
    return null;
  }
}

function safeMediaUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

function resolveMediaReference(
  raw: string,
  context: ParseContext,
): { readonly media: AgentMediaRef; readonly aliasType?: "photo" | "video" | "audio" | "document" } | null {
  const safe = safeMediaUrl(raw);
  if (safe) return { media: { kind: "url", url: safe } };

  try {
    const url = new URL(raw);
    if (url.protocol !== "tg:" || !["photo", "video", "audio", "document"].includes(url.hostname)) {
      return null;
    }
    const id = url.searchParams.get("id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    const media = context.options.richMedia?.[id];
    if (!media) return null;
    return {
      media,
      aliasType: url.hostname as "photo" | "video" | "audio" | "document",
    };
  } catch {
    return null;
  }
}

function nextFootnote(identifier: string, context: ParseContext): number {
  const existing = context.footnotes.get(identifier);
  if (existing !== undefined) return existing;
  const number = context.nextFootnote++;
  context.footnotes.set(identifier, number);
  return number;
}

function parseDecoratedText(value: string): AgentInline {
  const candidates = [
    { token: "==", type: "marked" as const, index: value.indexOf("==") },
    { token: "||", type: "spoiler" as const, index: value.indexOf("||") },
  ].filter((candidate) => candidate.index >= 0).sort((a, b) => a.index - b.index);
  const first = candidates[0];
  if (!first) return value;
  const close = value.indexOf(first.token, first.index + 2);
  if (close < 0) return value;
  return concatInline([
    value.slice(0, first.index),
    { type: first.type, text: parseDecoratedText(value.slice(first.index + 2, close)) },
    parseDecoratedText(value.slice(close + 2)),
  ]);
}

function linkInline(text: AgentInline, href: string, context: ParseContext): AgentInline {
  if (href.startsWith("#")) {
    const name = href.slice(1);
    return context.footnotes.has(name) || context.references.has(name)
      ? { type: "reference_link", text, referenceName: name }
      : { type: "anchor_link", text, anchorName: name };
  }
  try {
    const url = new URL(href);
    if (url.protocol === "mailto:") return { type: "email", text, email: href.slice(7) };
    if (url.protocol === "tel:") return { type: "phone", text, phone: href.slice(4) };
  } catch {}
  if (context.options.allowTelegramUserLinks === true) {
    try {
      const url = new URL(href);
      const userId = url.searchParams.get("id") ?? "";
      if (url.protocol === "tg:" && url.hostname === "user" && /^\d+$/.test(userId)) {
        return { type: "telegram_user_link", text, userId };
      }
    } catch {}
  }
  const safe = safeExternalUrl(href);
  return safe ? { type: "url", text, url: safe } : text;
}

function telegramInlineImage(node: MdNode): AgentInline | null {
  const raw = node.url ?? "";
  const alt = node.alt?.trim() || "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "tg:") return null;
    if (url.hostname === "emoji") {
      const id = url.searchParams.get("id");
      if (id && /^\d+$/.test(id)) {
        return { type: "custom_emoji", customEmojiId: id, alternativeText: alt || "🙂" };
      }
    }
    if (url.hostname === "time") {
      const unixTime = Number(url.searchParams.get("unix"));
      const format = dateTimeFormat(url.searchParams.get("format") ?? "");
      if (Number.isInteger(unixTime) && format !== null) {
        return { type: "date_time", text: alt || String(unixTime), unixTime, format };
      }
    }
  } catch {}
  return null;
}

function buttonText(value: AgentInline): RichText {
  if (typeof value === "string") return value;
  if (isInlineArray(value)) return value.map(buttonText);
  if (value.type === "custom_emoji") {
    return { type: "custom_emoji", custom_emoji_id: value.customEmojiId, alternative_text: value.alternativeText };
  }
  if (value.type === "date_time") {
    return { type: "date_time", text: buttonText(value.text), unix_time: value.unixTime, date_time_format: value.format };
  }
  return inlinePlain(value);
}

function buttonStyle(raw: string | true | undefined): "danger" | "success" | "primary" | "link" | undefined {
  return raw === "danger" || raw === "success" || raw === "primary" || raw === "link" ? raw : undefined;
}

function parseButton(
  attrs: Readonly<Record<string, string | true>>,
  label: AgentInline,
  context: ParseContext,
): RichMessageButton | null {
  if (context.options.allowInteractiveButtons !== true) return null;
  const type = typeof attrs.type === "string" ? attrs.type : "";
  const requestedStyle = buttonStyle(attrs.style);
  const style = requestedStyle === "link" && type !== "callback_data" ? undefined : requestedStyle;
  const base = style ? { text: buttonText(label), style } : { text: buttonText(label) };

  if (type === "url" && typeof attrs.url === "string") {
    const url = safeTrustedButtonUrl(attrs.url);
    return url ? { ...base, url } : null;
  }
  if (type === "callback_data" && typeof attrs.data === "string") {
    const length = new TextEncoder().encode(attrs.data).byteLength;
    return length >= 1 && length <= 64 ? { ...base, callback_data: attrs.data } : null;
  }
  if (type === "web_app" && typeof attrs.url === "string") {
    const url = safeMediaUrl(attrs.url);
    return url?.startsWith("https://") ? { ...base, web_app: { url } } : null;
  }
  if (type === "login_url" && typeof attrs.url === "string") {
    const url = safeMediaUrl(attrs.url);
    if (!url?.startsWith("https://")) return null;
    return {
      ...base,
      login_url: {
        url,
        ...(typeof attrs["forward-text"] === "string" ? { forward_text: attrs["forward-text"] } : {}),
        ...(attrs["request-write-access"] !== undefined ? { request_write_access: true } : {}),
      },
    };
  }
  if (type === "copy_text" && typeof attrs.text === "string") {
    return { ...base, copy_text: { text: attrs.text } };
  }
  if (type === "switch_inline_query") {
    return { ...base, switch_inline_query: typeof attrs.query === "string" ? attrs.query : "" };
  }
  if (type === "switch_inline_query_current_chat") {
    return { ...base, switch_inline_query_current_chat: typeof attrs.query === "string" ? attrs.query : "" };
  }
  if (type === "switch_inline_query_chosen_chat") {
    return {
      ...base,
      switch_inline_query_chosen_chat: {
        ...(typeof attrs.query === "string" ? { query: attrs.query } : {}),
        ...(attrs["allow-user-chats"] !== undefined ? { allow_user_chats: true } : {}),
        ...(attrs["allow-bot-chats"] !== undefined ? { allow_bot_chats: true } : {}),
        ...(attrs["allow-group-chats"] !== undefined ? { allow_group_chats: true } : {}),
        ...(attrs["allow-channel-chats"] !== undefined ? { allow_channel_chats: true } : {}),
      },
    };
  }
  if (type === "disabled") return { ...base, disabled: {} };
  return null;
}

function frameInline(frame: InlineFrame, context: ParseContext): AgentInline {
  const text = concatInline(frame.content);
  switch (frame.tag) {
    case "b":
    case "strong": return { type: "bold", text };
    case "i":
    case "em": return { type: "italic", text };
    case "u":
    case "ins": return { type: "underline", text };
    case "s":
    case "strike":
    case "del": return { type: "strikethrough", text };
    case "mark": return { type: "marked", text };
    case "sub": return { type: "subscript", text };
    case "sup": return { type: "superscript", text };
    case "code": return { type: "code", text };
    case "tg-spoiler": return { type: "spoiler", text };
    case "tg-math": return { type: "math", expression: inlinePlain(text) };
    case "tg-reference": {
      const name = typeof frame.attrs.name === "string" ? frame.attrs.name : "";
      return name ? { type: "reference", text, name } : text;
    }
    case "tg-emoji": {
      const id = typeof frame.attrs["emoji-id"] === "string" ? frame.attrs["emoji-id"] : "";
      return /^\d+$/.test(id) ? { type: "custom_emoji", customEmojiId: id, alternativeText: inlinePlain(text) || "🙂" } : text;
    }
    case "tg-time": {
      const unixTime = integerAttr(frame.attrs, "unix");
      const format = dateTimeFormat(frame.attrs.format);
      return unixTime !== undefined && format !== null ? { type: "date_time", text, unixTime, format } : text;
    }
    case "tg-button": {
      const button = parseButton(frame.attrs, text, context);
      return button ? { type: "button", button } : text;
    }
    case "a": {
      const href = typeof frame.attrs.href === "string" ? frame.attrs.href : null;
      const name = typeof frame.attrs.name === "string" ? frame.attrs.name : null;
      if (href) return linkInline(text, href, context);
      return name ? concatInline([{ type: "anchor", name }, text]) : text;
    }
    default: return text;
  }
}

function recognizedInlineTag(name: string): boolean {
  return [
    "b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "mark",
    "sub", "sup", "code", "tg-spoiler", "tg-math", "tg-reference",
    "tg-emoji", "tg-time", "tg-button", "a",
  ].includes(name);
}

function appendInline(roots: AgentInline[], stack: InlineFrame[], value: AgentInline): void {
  const target = stack.at(-1)?.content ?? roots;
  if (typeof value === "string" && value.length === 0) return;
  const previous = target.at(-1);
  if (typeof previous === "string" && typeof value === "string") target[target.length - 1] = previous + value;
  else target.push(value);
}

function consumeInlineHtml(
  raw: string,
  roots: AgentInline[],
  stack: InlineFrame[],
  context: ParseContext,
): boolean {
  const tag = parseHtmlTag(raw);
  if (!tag) return false;
  if (!tag.closing && tag.name === "br") {
    appendInline(roots, stack, "\n");
    return true;
  }
  if (!tag.closing && tag.name === "img" && typeof tag.attrs.src === "string") {
    const rich = telegramInlineImage({
      type: "image",
      url: tag.attrs.src,
      alt: typeof tag.attrs.alt === "string" ? tag.attrs.alt : "",
    });
    if (rich) {
      appendInline(roots, stack, rich);
      return true;
    }
  }
  if (!recognizedInlineTag(tag.name)) return false;

  if (tag.closing) {
    const index = stack.map((frame) => frame.tag).lastIndexOf(tag.name);
    if (index < 0) {
      appendInline(roots, stack, raw);
      return true;
    }
    const frame = stack.splice(index, 1)[0]!;
    appendInline(roots, stack, frameInline(frame, context));
    return true;
  }
  const frame: InlineFrame = { tag: tag.name, attrs: tag.attrs, rawOpen: raw, content: [] };
  if (tag.selfClosing) appendInline(roots, stack, frameInline(frame, context));
  else stack.push(frame);
  return true;
}

function inlineFromNode(node: MdNode, context: ParseContext): AgentInline {
  switch (node.type) {
    case "text": return parseDecoratedText(node.value ?? "");
    case "strong": return { type: "bold", text: inlineChildren(node, context) };
    case "emphasis": return { type: "italic", text: inlineChildren(node, context) };
    case "delete": return { type: "strikethrough", text: inlineChildren(node, context) };
    case "inlineCode": return { type: "code", text: node.value ?? "" };
    case "inlineMath": return { type: "math", expression: node.value ?? "" };
    case "break": return "\n";
    case "link": return linkInline(inlineChildren(node, context), node.url ?? "", context);
    case "image": return telegramInlineImage(node) ?? (node.alt?.trim() || node.url || "");
    case "footnoteReference": {
      const identifier = node.identifier ?? "?";
      return { type: "reference_link", text: "[" + nextFootnote(identifier, context) + "]", referenceName: identifier };
    }
    case "html": return node.value ?? "";
    default:
      return node.children ? inlineChildren(node, context) : (node.value ?? "");
  }
}

function inlineChildren(node: MdNode, context: ParseContext): AgentInline {
  const roots: AgentInline[] = [];
  const stack: InlineFrame[] = [];
  for (const child of node.children ?? []) {
    if (child.type === "html" && child.value && consumeInlineHtml(child.value, roots, stack, context)) continue;
    appendInline(roots, stack, inlineFromNode(child, context));
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    appendInline(roots, stack, concatInline([frame.rawOpen, concatInline(frame.content)]));
  }
  return concatInline(roots);
}

function sourceSlice(node: MdNode, context: ParseContext): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return start === undefined || end === undefined ? (node.value ?? "") : context.source.slice(start, end);
}

function mediaKind(raw: string): "photo" | "video" | "audio" | "animation" | "document" | "voice_note" {
  let path = raw.toLowerCase();
  try { path = new URL(raw).pathname.toLowerCase(); } catch {}
  if (/\.(?:jpg|jpeg|png|webp|bmp|heic|heif)$/.test(path)) return "photo";
  if (/\.gif$/.test(path)) return "animation";
  if (/\.(?:mp4|mov|m4v|webm)$/.test(path)) return "video";
  if (/\.(?:ogg|opus)$/.test(path)) return "voice_note";
  if (/\.(?:mp3|m4a|aac|wav|flac)$/.test(path)) return "audio";
  return "document";
}

function mediaBlock(node: MdNode, context: ParseContext): AgentBlock | null {
  if (!node.url) return null;
  const resolved = resolveMediaReference(node.url, context);
  if (!resolved) return null;
  const { media } = resolved;
  const captionText = node.title?.trim() || node.alt?.trim() || "";
  const caption: AgentCaption | undefined = captionText ? { text: captionText } : undefined;
  const common = caption ? { media, caption } : { media };
  const kind = resolved.aliasType ?? mediaKind(node.url);
  switch (kind) {
    case "photo": return { type: "photo", ...common };
    case "video": return { type: "video", ...common };
    case "audio": return { type: "audio", ...common };
    case "animation": return { type: "animation", ...common };
    case "voice_note": return { type: "voice_note", ...common };
    case "document": return { type: "document", ...common };
  }
}

function paragraphBlocks(node: MdNode, context: ParseContext): AgentBlock[] {
  const raw = sourceSlice(node, context).trim();
  if (raw.startsWith("<")) {
    const special = parseSpecialHtml(raw, context) ?? parseHtmlSequence(raw, context);
    if (special !== null) return special;
  }

  const children = node.children ?? [];
  if (children.length === 1 && children[0]?.type === "inlineMath") {
    const source = sourceSlice(children[0], context).trim();
    if (source.startsWith("$$") && source.endsWith("$$")) {
      return [{ type: "math", expression: children[0].value ?? "" }];
    }
  }
  const blocks: AgentBlock[] = [];
  let pending: MdNode[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    blocks.push({ type: "paragraph", text: inlineChildren({ type: "paragraph", children: pending }, context) });
    pending = [];
  };
  for (const child of children) {
    if (child.type === "image" && telegramInlineImage(child) === null) {
      const media = mediaBlock(child, context);
      if (media) {
        flush();
        blocks.push(media);
        continue;
      }
    }
    pending.push(child);
  }
  flush();
  return blocks;
}

function listBlock(node: MdNode, context: ParseContext): AgentBlock {
  const ordered = node.ordered === true;
  const start = Number.isInteger(node.start) ? Number(node.start) : 1;
  const items: AgentListItem[] = (node.children ?? []).map((item, index) => {
    const blocks = blocksFromNodes(item.children ?? [], context);
    const checked = typeof item.checked === "boolean" ? item.checked : undefined;
    return {
      ...(ordered ? { marker: "1" as const, value: start + index } : {}),
      ...(checked === undefined ? {} : { hasCheckbox: true, isChecked: checked }),
      blocks: blocks.length > 0 ? blocks : [{ type: "paragraph", text: "" }],
    };
  });
  return { type: "list", items };
}

function tableBlock(node: MdNode, context: ParseContext): AgentBlock {
  const align = node.align ?? [];
  const cells: AgentTableCell[][] = (node.children ?? []).map((row, rowIndex) =>
    (row.children ?? []).map((cell, columnIndex) => ({
      text: inlineChildren(cell, context),
      ...(rowIndex === 0 ? { isHeader: true } : {}),
      ...(align[columnIndex] ? { align: align[columnIndex]! } : {}),
    })),
  );
  return { type: "table", cells, isBordered: true };
}

function parseAttrs(raw: string): Readonly<Record<string, string | true>> {
  const token = parseHtmlTag("<x " + raw + ">");
  return token?.attrs ?? {};
}

function parseInlineMarkdown(markdown: string, context: ParseContext): AgentInline {
  const tree = processor.parse(markdown) as unknown as MdNode;
  const parts: AgentInline[] = [];
  for (const child of tree.children ?? []) {
    if (child.children) parts.push(inlineChildren(child, context));
    else if (child.value) parts.push(child.value);
  }
  return concatInline(parts);
}

function parseInlineHtml(raw: string, context: ParseContext): AgentInline {
  const roots: AgentInline[] = [];
  const stack: InlineFrame[] = [];
  for (const match of raw.matchAll(/<[^>]+>|[^<]+/g)) {
    const token = match[0] ?? "";
    if (token.startsWith("<")) {
      if (!consumeInlineHtml(token, roots, stack, context)) {
        appendInline(roots, stack, token);
      }
    } else {
      appendInline(roots, stack, decodeHtml(token));
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    appendInline(roots, stack, concatInline([frame.rawOpen, concatInline(frame.content)]));
  }
  return concatInline(roots);
}

function extractTag(raw: string, tag: string): { attrs: string; body: string } | null {
  const pattern = new RegExp("^\\s*<" + tag + "\\b([^>]*)>([\\s\\S]*)<\\/" + tag + ">\\s*$", "i");
  const match = raw.match(pattern);
  return match ? { attrs: match[1] ?? "", body: match[2] ?? "" } : null;
}

function stripTag(raw: string, tag: string): { body: string; rest: string } | null {
  const pattern = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i");
  const match = raw.match(pattern);
  return match ? { body: match[1] ?? "", rest: raw.replace(match[0], "") } : null;
}

function parseHtmlCaption(raw: string, context: ParseContext): AgentCaption {
  const credit = stripTag(raw, "cite");
  return {
    text: parseInlineHtml(credit?.rest ?? raw, context),
    ...(credit ? { credit: parseInlineHtml(credit.body, context) } : {}),
  };
}

function parseHtmlList(raw: string, context: ParseContext): AgentBlock | null {
  const unordered = extractTag(raw, "ul");
  const ordered = unordered ? null : extractTag(raw, "ol");
  const list = unordered ?? ordered;
  if (!list) return null;

  const listAttrs = parseAttrs(list.attrs);
  const matches = Array.from(list.body.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi));
  const orderedList = ordered !== null;
  const reversed = listAttrs.reversed !== undefined;
  const defaultStart = orderedList
    ? (integerAttr(listAttrs, "start") ?? (reversed ? matches.length : 1))
    : 1;
  const listType = typeof listAttrs.type === "string" &&
    ["a", "A", "i", "I", "1"].includes(listAttrs.type)
    ? listAttrs.type as "a" | "A" | "i" | "I" | "1"
    : "1";

  const items: AgentListItem[] = matches.map((match, index) => {
    const attrs = parseAttrs(match[1] ?? "");
    let body = match[2] ?? "";
    const input = body.match(/<input\b([^>]*)\/?\s*>/i);
    let hasCheckbox = false;
    let isChecked = false;
    if (input) {
      const inputAttrs = parseAttrs(input[1] ?? "");
      if (inputAttrs.type === "checkbox") {
        hasCheckbox = true;
        isChecked = inputAttrs.checked !== undefined;
        body = body.replace(input[0], "");
      }
    }

    const paragraph = extractTag(body.trim(), "p");
    const text = parseInlineHtml(paragraph?.body ?? body, context);
    const itemType = typeof attrs.type === "string" &&
      ["a", "A", "i", "I", "1"].includes(attrs.type)
      ? attrs.type as "a" | "A" | "i" | "I" | "1"
      : listType;
    const explicit = integerAttr(attrs, "value");
    const value = explicit ?? (reversed ? defaultStart - index : defaultStart + index);
    return {
      ...(orderedList ? { marker: itemType, value } : {}),
      ...(hasCheckbox ? { hasCheckbox: true, isChecked } : {}),
      blocks: [{ type: "paragraph", text }],
    };
  });

  return { type: "list", items };
}

function parseHtmlTable(raw: string, context: ParseContext): AgentBlock | null {
  const table = extractTag(raw, "table");
  if (!table) return null;
  const attrs = parseAttrs(table.attrs);
  const captionTag = stripTag(table.body, "caption");
  const body = captionTag?.rest ?? table.body;
  const cells: AgentTableCell[][] = [];

  for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowCells: AgentTableCell[] = [];
    for (const cell of (row[1] ?? "").matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const cellAttrs = parseAttrs(cell[2] ?? "");
      const align = cellAttrs.align;
      const valign = cellAttrs.valign;
      const colspan = integerAttr(cellAttrs, "colspan");
      const rowspan = integerAttr(cellAttrs, "rowspan");
      rowCells.push({
        text: parseInlineHtml(cell[3] ?? "", context),
        ...(cell[1]?.toLowerCase() === "th" ? { isHeader: true } : {}),
        ...(align === "left" || align === "center" || align === "right" ? { align } : {}),
        ...(valign === "top" || valign === "middle" || valign === "bottom" ? { valign } : {}),
        ...(colspan !== undefined && colspan > 1 ? { colspan } : {}),
        ...(rowspan !== undefined && rowspan > 1 ? { rowspan } : {}),
      });
    }
    if (rowCells.length > 0) cells.push(rowCells);
  }

  return {
    type: "table",
    cells,
    ...(attrs.bordered !== undefined ? { isBordered: true } : {}),
    ...(attrs.striped !== undefined ? { isStriped: true } : {}),
    ...(attrs.compact !== undefined ? { isCompact: true } : {}),
    ...(captionTag ? { caption: { text: parseInlineHtml(captionTag.body, context) } } : {}),
  };
}

function attachCaption(block: AgentBlock, caption: AgentCaption | undefined): AgentBlock {
  if (!caption) return block;
  switch (block.type) {
    case "photo":
    case "video":
    case "audio":
    case "animation":
    case "document":
    case "voice":
    case "voice_note":
    case "map":
      return { ...block, caption };
    default:
      return block;
  }
}

function parseHtmlFigure(raw: string, context: ParseContext): AgentBlock | null {
  const figure = extractTag(raw, "figure");
  if (!figure) return null;
  const captionTag = stripTag(figure.body, "figcaption");
  const body = (captionTag?.rest ?? figure.body).trim();
  const caption = captionTag ? parseHtmlCaption(captionTag.body, context) : undefined;
  const media = parseSingleMediaHtml(body, context) ?? parseMap(body);
  return media ? attachCaption(media, caption) : null;
}

function parseBasicHtmlBlock(raw: string, context: ParseContext): AgentBlock[] | null {
  const trimmed = raw.trim();

  const heading = trimmed.match(/^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>$/i);
  if (heading) {
    return [{
      type: "heading",
      level: Number(heading[1]) as 1 | 2 | 3 | 4 | 5 | 6,
      text: parseInlineHtml(heading[2] ?? "", context),
    }];
  }

  const paragraph = extractTag(trimmed, "p");
  if (paragraph) return [{ type: "paragraph", text: parseInlineHtml(paragraph.body, context) }];

  const footer = extractTag(trimmed, "footer");
  if (footer) return [{ type: "footer", text: parseInlineHtml(footer.body, context) }];

  if (/^<hr\s*\/?\s*>$/i.test(trimmed)) return [{ type: "divider" }];

  const pre = extractTag(trimmed, "pre");
  if (pre) {
    const nested = pre.body.match(/^\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*$/i);
    if (!nested) return [{ type: "code", text: decodeHtml(pre.body) }];
    const attrs = parseAttrs(nested[1] ?? "");
    const className = typeof attrs.class === "string" ? attrs.class : "";
    const language = className.match(/(?:^|\s)language-([^\s]+)/)?.[1]
      ?.replace(/[^A-Za-z0-9_+#.-]/g, "")
      .slice(0, 48);
    return [{
      type: "code",
      text: decodeHtml(nested[2] ?? ""),
      ...(language ? { language } : {}),
    }];
  }

  const list = parseHtmlList(trimmed, context);
  if (list) return [list];

  const table = parseHtmlTable(trimmed, context);
  if (table) return [table];

  const figure = parseHtmlFigure(trimmed, context);
  if (figure) return [figure];

  if (/^<(?:b|strong|i|em|u|ins|s|strike|del|mark|sub|sup|code|tg-spoiler|tg-math|tg-reference|tg-emoji|tg-time|a)\b/i.test(trimmed) || /^<tg-button(?:\s|>)/i.test(trimmed)) {
    return [{ type: "paragraph", text: parseInlineHtml(trimmed, context) }];
  }

  return null;
}

function parseSingleMediaHtml(raw: string, context: ParseContext): AgentBlock | null {
  const tagMatch = raw.trim().match(/^<(img|video|audio|tg-document)\b([^>]*)\/?>(?:<\/\1>)?$/i);
  if (!tagMatch) return null;
  const tag = tagMatch[1]!.toLowerCase();
  const attrs = parseAttrs(tagMatch[2] ?? "");
  const resolved = typeof attrs.src === "string" ? resolveMediaReference(attrs.src, context) : null;
  if (!resolved) return null;
  const { media } = resolved;
  const source = typeof attrs.src === "string" ? attrs.src : "";
  const spoiler = attrs["tg-spoiler"] !== undefined;
  if (tag === "img") return { type: "photo", media, ...(spoiler ? { spoiler: true } : {}) };
  if (tag === "video") return mediaKind(source) === "animation"
    ? { type: "animation", media, ...(spoiler ? { spoiler: true } : {}) }
    : { type: "video", media, ...(spoiler ? { spoiler: true } : {}) };
  if (tag === "audio") return mediaKind(source) === "voice_note" ? { type: "voice_note", media } : { type: "audio", media };
  return { type: "document", media };
}

function parseButtonRow(raw: string, context: ParseContext): AgentBlock[] | null {
  const row = extractTag(raw, "tg-button-row");
  if (!row) return null;
  const rowAttrs = parseAttrs(row.attrs);
  const buttons: RichMessageButton[] = [];
  const visible: AgentInline[] = [];
  const pattern = /<tg-button\b([^>]*)>([\s\S]*?)<\/tg-button>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(row.body)) !== null) {
    const label = parseInlineMarkdown(match[2] ?? "", context);
    visible.push(label);
    const button = parseButton(parseAttrs(match[1] ?? ""), label, context);
    if (button) buttons.push(button);
  }
  if (buttons.length === 0) {
    return visible.length ? [{ type: "paragraph", text: concatInline(visible) }] : [];
  }
  const align = rowAttrs.align;
  return [{
    type: "buttons",
    buttons: buttons.slice(0, 8),
    ...(align === "left" || align === "center" || align === "right" ? { align } : {}),
  }];
}

function parseMap(raw: string): AgentBlock | null {
  const match = raw.trim().match(/^<tg-map\b([^>]*)>([\s\S]*?)<\/tg-map>$/i) ??
    raw.trim().match(/^<tg-map\b([^>]*)\/?>(?:\s*)$/i);
  if (!match) return null;
  const attrs = parseAttrs(match[1] ?? "");
  const latitude = floatAttr(attrs, "lat");
  const longitude = floatAttr(attrs, "long");
  if (latitude === undefined || longitude === undefined) return null;
  const zoom = integerAttr(attrs, "zoom");
  const width = integerAttr(attrs, "width");
  const height = integerAttr(attrs, "height");
  return {
    type: "map",
    latitude,
    longitude,
    ...(zoom !== undefined ? { zoom: Math.min(24, Math.max(0, zoom)) } : {}),
    ...(width !== undefined ? { width: Math.max(0, width) } : {}),
    ...(height !== undefined ? { height: Math.max(0, height) } : {}),
  };
}

function parseHtmlSequence(raw: string, context: ParseContext): AgentBlock[] | null {
  const fragment = parseFragment(raw, { sourceCodeLocationInfo: true }) as unknown as {
    childNodes: Array<{
      nodeName: string;
      value?: string;
      sourceCodeLocation?: { startOffset: number; endOffset: number };
    }>;
  };

  const blocks: AgentBlock[] = [];
  let sawElement = false;
  for (const child of fragment.childNodes) {
    if (child.nodeName === "#text") {
      if ((child.value ?? "").trim().length === 0) continue;
      return null;
    }
    const location = child.sourceCodeLocation;
    if (!location) return null;
    const slice = raw.slice(location.startOffset, location.endOffset);
    const parsed = parseSpecialHtml(slice, context);
    if (!parsed) return null;
    sawElement = true;
    blocks.push(...parsed);
  }
  return sawElement ? blocks : null;
}

function parseSpecialHtml(raw: string, context: ParseContext): AgentBlock[] | null {
  const basic = parseBasicHtmlBlock(raw, context);
  if (basic) return basic;

  const details = extractTag(raw, "details");
  if (details) {
    const summary = stripTag(details.body, "summary");
    const attrs = parseAttrs(details.attrs);
    return [{
      type: "details",
      summary: summary ? parseInlineMarkdown(summary.body, context) : "",
      blocks: parseMarkdownDocument(summary?.rest ?? details.body, context.options).blocks,
      ...(attrs.open !== undefined ? { isOpen: true } : {}),
    }];
  }

  for (const tag of ["tg-collage", "tg-slideshow"] as const) {
    const group = extractTag(raw, tag);
    if (!group) continue;
    const caption = stripTag(group.body, "figcaption");
    const parsed = parseMarkdownDocument(caption?.rest ?? group.body, context.options);
    const media = parsed.blocks.filter((block) =>
      ["photo", "video", "audio", "animation", "document", "voice_note", "voice"].includes(block.type));
    return [{
      type: tag === "tg-collage" ? "collage" : "slideshow",
      blocks: media,
      ...(caption ? { caption: parseHtmlCaption(caption.body, context) } : {}),
    }];
  }

  const aside = extractTag(raw, "aside");
  if (aside) {
    const credit = stripTag(aside.body, "cite");
    return [{
      type: "pullquote",
      text: parseInlineHtml(credit?.rest ?? aside.body, context),
      ...(credit ? { credit: parseInlineHtml(credit.body, context) } : {}),
    }];
  }

  const blockquote = extractTag(raw, "blockquote");
  if (blockquote) {
    const attrs = parseAttrs(blockquote.attrs);
    const credit = stripTag(blockquote.body, "cite");
    const body = credit?.rest ?? blockquote.body;
    if (attrs.expandable !== undefined || attrs.collapsed !== undefined) {
      return [{
        type: "quote",
        text: parseInlineHtml(body, context),
        expandable: true,
        ...(credit ? { credit: parseInlineHtml(credit.body, context) } : {}),
      }];
    }
    return [{
      type: "quote",
      text: "",
      blocks: [{ type: "paragraph", text: parseInlineHtml(body, context) }],
      ...(credit ? { credit: parseInlineHtml(credit.body, context) } : {}),
    }];
  }

  const math = extractTag(raw, "tg-math-block");
  if (math) return [{ type: "math", expression: math.body }];

  const thinking = extractTag(raw, "tg-thinking");
  if (thinking) return [{ type: "thinking", text: parseInlineMarkdown(thinking.body, context) }];

  const buttonRow = parseButtonRow(raw, context);
  if (buttonRow) return buttonRow;

  const map = parseMap(raw);
  if (map) return [map];

  const media = parseSingleMediaHtml(raw, context);
  if (media) return [media];

  const anchor = raw.trim().match(/^<a\s+name=(?:"([^"]+)"|'([^']+)')\s*><\/a>$/i);
  if (anchor) return [{ type: "anchor", name: anchor[1] ?? anchor[2] ?? "" }];

  return null;
}

function groupedHtml(
  nodes: readonly MdNode[],
  index: number,
  context: ParseContext,
): { raw: string; endIndex: number } | null {
  const node = nodes[index];
  if (!node || node.type !== "html" || !node.value) return null;
  const tag = parseHtmlTag(node.value);
  if (!tag || tag.closing || tag.selfClosing || !GROUPABLE_TAGS.has(tag.name)) return null;
  if (new RegExp("<\\/" + tag.name + ">\\s*$", "i").test(node.value.trim())) {
    return { raw: node.value, endIndex: index };
  }
  for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
    const candidate = nodes[cursor];
    if (candidate?.type !== "html" || !candidate.value) continue;
    if (!new RegExp("<\\/" + tag.name + ">\\s*$", "i").test(candidate.value.trim())) continue;
    const start = node.position?.start?.offset;
    const end = candidate.position?.end?.offset;
    if (start !== undefined && end !== undefined) {
      return { raw: context.source.slice(start, end), endIndex: cursor };
    }
  }
  return null;
}

function footnoteBlock(node: MdNode, context: ParseContext): AgentBlock {
  const identifier = node.identifier ?? "?";
  nextFootnote(identifier, context);
  const text = concatInline((node.children ?? []).map((child) =>
    child.children ? inlineChildren(child, context) : (child.value ?? "")));
  return { type: "footer", text: { type: "reference", text, name: identifier } };
}

function blocksFromNodes(nodes: readonly MdNode[], context: ParseContext): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;

    if (node.type === "html") {
      const grouped = groupedHtml(nodes, index, context);
      if (grouped) {
        blocks.push(...(parseSpecialHtml(grouped.raw, context) ?? [{ type: "paragraph", text: grouped.raw }]));
        index = grouped.endIndex;
        continue;
      }
    }

    switch (node.type) {
      case "paragraph":
        blocks.push(...paragraphBlocks(node, context));
        break;
      case "heading":
        blocks.push({
          type: "heading",
          text: inlineChildren(node, context),
          level: Math.min(6, Math.max(1, node.depth ?? 1)) as 1 | 2 | 3 | 4 | 5 | 6,
        });
        break;
      case "code": {
        const language = node.lang?.trim().split(/\s+/, 1)[0]?.replace(/[^A-Za-z0-9_+#.-]/g, "").slice(0, 48);
        blocks.push(language === "math" || language === "latex"
          ? { type: "math", expression: node.value ?? "" }
          : { type: "code", text: node.value ?? "", ...(language ? { language } : {}) });
        break;
      }
      case "math":
        blocks.push({ type: "math", expression: node.value ?? "" });
        break;
      case "blockquote": {
        const nested = blocksFromNodes(node.children ?? [], context);
        blocks.push(nested.length === 1 && nested[0]?.type === "paragraph"
          ? { type: "quote", text: nested[0].text }
          : { type: "quote", text: "", blocks: nested });
        break;
      }
      case "list":
        blocks.push(listBlock(node, context));
        break;
      case "table":
        blocks.push(tableBlock(node, context));
        break;
      case "thematicBreak":
        blocks.push({ type: "divider" });
        break;
      case "html": {
        const raw = node.value ?? "";
        blocks.push(...(
          parseSpecialHtml(raw, context) ??
          parseHtmlSequence(raw, context) ??
          [{ type: "paragraph", text: raw }]
        ));
        break;
      }
      case "footnoteDefinition":
        blocks.push(footnoteBlock(node, context));
        break;
      case "definition":
        break;
      default:
        if (node.children) blocks.push(...blocksFromNodes(node.children, context));
        else if (node.value) blocks.push({ type: "paragraph", text: node.value });
    }
  }
  return blocks;
}

export function parseMarkdownDocument(
  markdown: string,
  options: ParseMarkdownDocumentOptions = {},
): AgentDocument {
  const tree = processor.parse(markdown) as unknown as MdNode;
  const context: ParseContext = {
    source: markdown,
    options,
    footnotes: new Map(),
    references: new Set(),
    nextFootnote: 1,
  };
  for (const node of tree.children ?? []) {
    if (node.type === "footnoteDefinition" && node.identifier) nextFootnote(node.identifier, context);
  }
  for (const match of markdown.matchAll(/<tg-reference\b[^>]*\bname\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)) {
    const name = match[1] ?? match[2];
    if (name) context.references.add(name);
  }
  return {
    blocks: blocksFromNodes(tree.children ?? [], context),
    ...(options.rtl === undefined ? {} : { rtl: options.rtl }),
  };
}
