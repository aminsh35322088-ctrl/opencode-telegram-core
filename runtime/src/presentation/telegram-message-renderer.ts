import type { MessageEntity } from "grammy/types";
import type { AgentBlock, AgentDocument } from "./agent-document.js";
import { sanitizeAgentDocumentBidi } from "./agent-document-bidi.js";
import type { AgentInline } from "./agent-inline.js";
import { blockPlainText, inlinePlainText } from "./agent-document-text.js";
import {
  parseMarkdownDocument,
  type ParseMarkdownDocumentOptions,
} from "./markdown-document-parser.js";

/** Regular-message serialization of the same semantic document used by Rich Messages. */
export interface TelegramMessageChunk {
  readonly text: string;
  readonly html: string;
  readonly markdownV2: string;
  readonly entities: MessageEntity[];
  readonly document: AgentDocument;
}
export interface TelegramMessageRenderOptions {
  readonly maxCharacters?: number;
}
type EntityMark<T = MessageEntity> = T extends MessageEntity
  ? Omit<T, "offset" | "length">
  : never;
type Mark = EntityMark;
interface Run {
  text: string;
  marks: readonly Mark[];
}
const styles = new Set([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "spoiler",
]);
const codeTypes = new Set(["code", "pre"]);
const quoteTypes = new Set(["blockquote", "expandable_blockquote"]);
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Directional overrides/embeddings are unsafe in prose; preserve ZWNJ and authored code. */
function prose(value: string): string {
  // Explicit isolation is owned by semantic directional_isolate nodes, never raw markup.
  return value.replace(/[\u202a-\u202e\u2066-\u2069]/gu, "");
}
function same(a: Mark, b: Mark): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function safeUrl(value: string): boolean {
  try {
    return (
      !/[\u0000-\u0020\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
        value,
      ) &&
      ["http:", "https:", "mailto:", "tel:"].includes(new URL(value).protocol)
    );
  } catch {
    return false;
  }
}
function addMark(marks: readonly Mark[], mark: Mark): readonly Mark[] {
  if (marks.some((m) => codeTypes.has(m.type))) return marks;
  if (marks.some((m) => m.type === mark.type)) return marks;
  if (codeTypes.has(mark.type)) return [mark];
  // Telegram's non-style entities cannot contain one another.
  if (!styles.has(mark.type))
    return [...marks.filter((m) => styles.has(m.type)), mark];
  return [...marks, mark];
}
function inline(value: AgentInline, marks: readonly Mark[], out: Run[]): void {
  if (typeof value === "string") {
    const text = marks.some((m) => codeTypes.has(m.type))
      ? value
      : prose(value);
    if (text) out.push({ text, marks });
    return;
  }
  if (Array.isArray(value)) {
    for (const part of value) inline(part, marks, out);
    return;
  }
  const node = value as Exclude<AgentInline, string | readonly AgentInline[]>;
  switch (node.type) {
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "spoiler":
    case "code":
      inline(
        node.type === "code" ? inlinePlainText(node.text) : node.text,
        addMark(marks, { type: node.type }),
        out,
      );
      return;
    case "url":
      inline(
        node.text,
        safeUrl(node.url)
          ? addMark(marks, { type: "text_link", url: node.url })
          : marks,
        out,
      );
      return;
    case "telegram_user_link":
      inline(
        node.text,
        /^\d+$/.test(node.userId)
          ? addMark(marks, {
              type: "text_link",
              url: `tg://user?id=${node.userId}`,
            })
          : marks,
        out,
      );
      return;
    case "text_mention":
      inline(
        node.text,
        addMark(marks, { type: "text_mention", user: node.user }),
        out,
      );
      return;
    case "custom_emoji":
      inline(
        node.alternativeText,
        /^\d+$/.test(node.customEmojiId)
          ? addMark(marks, {
              type: "custom_emoji",
              custom_emoji_id: node.customEmojiId,
            })
          : marks,
        out,
      );
      return;
    case "date_time":
      inline(
        node.text,
        addMark(marks, {
          type: "date_time",
          unix_time: node.unixTime,
          date_time_format: node.format,
        }),
        out,
      );
      return;
    case "math":
      inline(node.expression, addMark(marks, { type: "code" }), out);
      return;
    case "anchor":
      return;
    case "button":
      inline(inlinePlainText(node), marks, out);
      return;
    case "email":
      inline(
        node.text,
        addMark(marks, { type: "text_link", url: `mailto:${node.email}` }),
        out,
      );
      return;
    case "directional_isolate":
      // Modern Telegram clients implement Unicode bidi. Do not inject controls around English/code.
      inline(node.text, marks, out);
      return;
    default:
      inline(node.text, marks, out);
  }
}
function blocks(
  values: readonly AgentBlock[],
  marks: readonly Mark[],
  out: Run[],
  depth = 0,
): void {
  values.forEach((block, index) => {
    if (index) inline("\n\n", marks, out);
    switch (block.type) {
      case "paragraph":
      case "footer":
        inline(block.text, marks, out);
        break;
      case "heading":
        inline(block.text, addMark(marks, { type: "bold" }), out);
        break;
      case "code":
        inline(
          inlinePlainText(block.text),
          addMark(marks, {
            type: "pre",
            ...(block.language ? { language: block.language } : {}),
          }),
          out,
        );
        break;
      case "quote":
      case "pullquote": {
        const quoteMarks = marks.some((m) => quoteTypes.has(m.type))
          ? marks
          : addMark(marks, {
              type:
                block.type === "quote" && block.expandable
                  ? "expandable_blockquote"
                  : "blockquote",
            });
        if (block.type === "quote" && block.blocks?.length)
          blocks(block.blocks, quoteMarks, out, depth);
        else inline(block.text, quoteMarks, out);
        if (block.credit !== undefined) {
          inline("\n", quoteMarks, out);
          inline(block.credit, quoteMarks, out);
        }
        break;
      }
      case "divider":
        inline("────────", marks, out);
        break;
      case "math":
        inline(block.expression, addMark(marks, { type: "pre" }), out);
        break;
      case "list":
        block.items.forEach((item, i) => {
          if (i) inline("\n", marks, out);
          const marker = item.hasCheckbox
            ? item.isChecked
              ? "☑ "
              : "☐ "
            : item.marker
              ? `${item.value ?? i + 1}. `
              : "• ";
          inline("  ".repeat(depth) + marker, marks, out);
          blocks(item.blocks, marks, out, depth + 1);
        });
        break;
      case "table":
        inline(blockPlainText(block), addMark(marks, { type: "pre" }), out);
        break;
      case "details":
        inline(block.summary, addMark(marks, { type: "bold" }), out);
        inline("\n", marks, out);
        blocks(block.blocks, marks, out, depth);
        break;
      case "collage":
      case "slideshow":
        blocks(block.blocks, marks, out, depth);
        if (block.caption) inline(block.caption.text, marks, out);
        break;
      case "thinking":
      case "anchor":
      case "buttons":
        break;
      default:
        if (block.caption) inline(block.caption.text, marks, out);
    }
  });
}
const htmlEscape = (s: string): string =>
  s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const attribute = (s: string): string => htmlEscape(s).replace(/"/gu, "&quot;");
const textEscape = (s: string): string =>
  s.replace(/[\\_*[\]()~`>#+\-=|{}.!]/gu, "\\$&");
const codeEscape = (s: string): string => s.replace(/[\\`]/gu, "\\$&");
const destination = (s: string): string => s.replace(/[\\)]/gu, "\\$&");
function wrapper(
  mark: Mark,
  body: string,
  mode: "html" | "markdownV2",
): string {
  if (mode === "html") {
    const tags: Partial<Record<MessageEntity["type"], string>> = {
      bold: "b",
      italic: "i",
      underline: "u",
      strikethrough: "s",
      spoiler: "tg-spoiler",
      code: "code",
      blockquote: "blockquote",
      expandable_blockquote: "blockquote expandable",
    };
    if (mark.type === "pre")
      return `<pre>${mark.language ? `<code class="language-${attribute(mark.language)}">${body}</code>` : body}</pre>`;
    if (mark.type === "text_link")
      return `<a href="${attribute(mark.url!)}">${body}</a>`;
    if (mark.type === "text_mention")
      return `<a href="tg://user?id=${mark.user!.id}">${body}</a>`;
    if (mark.type === "custom_emoji")
      return `<tg-emoji emoji-id="${attribute(mark.custom_emoji_id!)}">${body}</tg-emoji>`;
    if (mark.type === "date_time")
      return `<tg-time unix="${mark.unix_time}" format="${attribute(mark.date_time_format ?? "")}">${body}</tg-time>`;
    const tag = tags[mark.type];
    return tag ? `<${tag}>${body}</${tag.split(" ")[0]}>` : body;
  }
  if (mark.type === "pre")
    return `\x60\x60\x60${(mark.language ?? "").replace(/[^\w+-]/gu, "")}\n${body}\n\x60\x60\x60`;
  if (mark.type === "code") return `\x60${body}\x60`;
  if (mark.type === "text_link" || mark.type === "text_mention")
    return `[${body}](${destination(mark.type === "text_link" ? mark.url : `tg://user?id=${mark.user.id}`)})`;
  if (mark.type === "custom_emoji")
    return `![${body}](tg://emoji?id=${mark.custom_emoji_id})`;
  if (mark.type === "date_time")
    return `![${body}](tg://time?unix=${mark.unix_time}&format=${mark.date_time_format ?? ""})`;
  if (quoteTypes.has(mark.type))
    return (
      "**" +
      body
        .split("\n")
        .map((line) => ">" + line)
        .join("\n") +
      (mark.type === "expandable_blockquote" ? "||" : "")
    );
  const delimiters: Record<string, string> = {
    bold: "*",
    italic: "_",
    underline: "__",
    strikethrough: "~",
    spoiler: "||",
  };
  const delimiter = delimiters[mark.type];
  if (!delimiter) return body;
  // Telegram greedily recognizes '__'. Bot API 10.3 uses an empty bold entity to separate ambiguous delimiters.
  const start = delimiter.endsWith("_") && body.startsWith("_") ? "**" : "";
  const end = delimiter.startsWith("_") && body.endsWith("_") ? "**" : "";
  return delimiter + start + body + end + delimiter;
}
function serialize(
  runs: readonly Run[],
  mode: "html" | "markdownV2",
  depth = 0,
): string {
  let result = "";
  for (let i = 0; i < runs.length;) {
    const run = runs[i]!;
    const mark = run.marks[depth];
    if (!mark) {
      result +=
        mode === "html"
          ? htmlEscape(run.text)
          : run.marks.some((m) => codeTypes.has(m.type))
            ? codeEscape(run.text)
            : textEscape(run.text);
      i++;
      continue;
    }
    let end = i + 1;
    while (
      end < runs.length &&
      runs[end]!.marks[depth] &&
      same(mark, runs[end]!.marks[depth]!)
    )
      end++;
    const piece = wrapper(
      mark,
      serialize(runs.slice(i, end), mode, depth + 1),
      mode,
    );
    if (mode === "markdownV2" && result.endsWith("_") && piece.startsWith("_"))
      result += "**";
    result += piece;
    i = end;
  }
  return result;
}
function entitiesFor(runs: readonly Run[]): MessageEntity[] {
  const result: MessageEntity[] = [];
  const active: Array<{ mark: Mark; entity: MessageEntity }> = [];
  let offset = 0;
  for (const run of runs) {
    let common = 0;
    while (
      common < active.length &&
      common < run.marks.length &&
      same(active[common]!.mark, run.marks[common]!)
    )
      common++;
    active.length = common;
    for (let i = common; i < run.marks.length; i++) {
      const mark = run.marks[i]!;
      const entity = { ...mark, offset, length: 0 } as MessageEntity;
      result.push(entity);
      active.push({ mark, entity });
    }
    for (const { entity } of active) entity.length += run.text.length;
    offset += run.text.length;
  }
  return result;
}
function documentFor(
  runs: readonly Run[],
  rtl: boolean | undefined,
): AgentDocument {
  // Inline styles share the IR; pre and quotes retain native block semantics.
  function styled(run: Run): AgentInline {
    let value: AgentInline = run.text;
    for (const mark of [...run.marks].reverse()) {
      if (styles.has(mark.type) || mark.type === "code")
        value = {
          type: mark.type as
            | "bold"
            | "italic"
            | "underline"
            | "strikethrough"
            | "spoiler"
            | "code",
          text: value,
        };
      else if (mark.type === "text_link")
        value = mark.url.startsWith("tg://user?id=")
          ? {
              type: "telegram_user_link",
              userId: mark.url.slice("tg://user?id=".length),
              text: value,
            }
          : { type: "url", url: mark.url, text: value };
      else if (mark.type === "text_mention")
        value = { type: "text_mention", user: mark.user, text: value };
      else if (mark.type === "custom_emoji")
        value = {
          type: "custom_emoji",
          customEmojiId: mark.custom_emoji_id!,
          alternativeText: run.text,
        };
      else if (mark.type === "date_time")
        value = {
          type: "date_time",
          text: value,
          unixTime: mark.unix_time,
          format: mark.date_time_format ?? "",
        };
    }
    return value;
  }
  const result: AgentBlock[] = [];
  for (let i = 0; i < runs.length;) {
    const special = runs[i]!.marks.find(
      (mark) => mark.type === "pre" || quoteTypes.has(mark.type),
    );
    let end = i + 1;
    while (end < runs.length) {
      const next = runs[end]!.marks.find(
        (mark) => mark.type === "pre" || quoteTypes.has(mark.type),
      );
      if (special ? !next || !same(special, next) : next) break;
      end++;
    }
    const content = runs.slice(i, end).map(styled);
    if (special?.type === "pre")
      result.push({
        type: "code",
        text: content,
        ...(special.language ? { language: special.language } : {}),
      });
    else if (special)
      result.push({
        type: "quote",
        text: content,
        ...(special.type === "expandable_blockquote"
          ? { expandable: true }
          : {}),
      });
    else result.push({ type: "paragraph", text: content });
    i = end;
  }
  return { blocks: result, ...(rtl === undefined ? {} : { rtl }) };
}
export function renderTelegramMessageDocument(
  document: AgentDocument,
  options: TelegramMessageRenderOptions = {},
): TelegramMessageChunk[] {
  const limit = options.maxCharacters ?? 4096;
  if (!Number.isInteger(limit) || limit < 2 || limit > 4096)
    throw new RangeError("maxCharacters must be an integer between 2 and 4096");
  const runs: Run[] = [];
  blocks(sanitizeAgentDocumentBidi(document).blocks, [], runs);
  const text = runs.map((run) => run.text).join("");
  const boundaries: number[] = [];
  let used = 0;
  let offset = 0;
  for (const { segment } of segmenter.segment(text)) {
    const pieces = segment.length > limit ? Array.from(segment) : [segment];
    for (const piece of pieces) {
      if (used && used + piece.length > limit) {
        boundaries.push(offset);
        used = 0;
      }
      offset += piece.length;
      used += piece.length;
    }
  }
  if (used) boundaries.push(offset);
  const chunks: Run[][] = [];
  let runIndex = 0;
  let runOffset = 0;
  let position = 0;
  for (const end of boundaries) {
    const chunk: Run[] = [];
    while (position < end) {
      const run = runs[runIndex]!;
      const take = Math.min(end - position, run.text.length - runOffset);
      chunk.push({
        text: run.text.slice(runOffset, runOffset + take),
        marks: run.marks,
      });
      position += take;
      runOffset += take;
      if (runOffset === run.text.length) {
        runIndex++;
        runOffset = 0;
      }
    }
    chunks.push(chunk);
  }
  return chunks.map((chunk) => ({
    text: chunk.map((r) => r.text).join(""),
    html: serialize(chunk, "html"),
    markdownV2: serialize(chunk, "markdownV2"),
    entities: entitiesFor(chunk),
    document: documentFor(chunk, document.rtl),
  }));
}
export function renderTelegramMessageMarkdown(
  markdown: string,
  options: ParseMarkdownDocumentOptions & TelegramMessageRenderOptions = {},
): TelegramMessageChunk[] {
  return renderTelegramMessageDocument(
    parseMarkdownDocument(markdown, options),
    options,
  );
}
