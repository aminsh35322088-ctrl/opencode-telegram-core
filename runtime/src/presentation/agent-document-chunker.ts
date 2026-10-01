import type {
  AgentBlock,
  AgentCaption,
  AgentDocument,
  AgentListItem,
  AgentTableCell,
} from "./agent-document.js";
import type { AgentInline } from "./agent-inline.js";
import { blockPlainText, inlinePlainText, inlineTelegramCharacterCount, unicodeLength } from "./agent-document-text.js";

export const TELEGRAM_RICH_MESSAGE_LIMITS = {
  textCharacters: 32768,
  blocks: 500,
  nesting: 16,
  media: 50,
  tableColumns: 20,
} as const;

export interface AgentDocumentChunkOptions {
  readonly maxCharacters?: number;
  readonly maxBlocks?: number;
  readonly maxNesting?: number;
  readonly maxMedia?: number;
  readonly maxTableColumns?: number;
}

export interface AgentDocumentMetrics {
  readonly characters: number;
  readonly blocks: number;
  readonly media: number;
}

interface ResolvedLimits {
  readonly maxCharacters: number;
  readonly maxBlocks: number;
  readonly maxNesting: number;
  readonly maxMedia: number;
  readonly maxTableColumns: number;
}

function resolveLimit(value: number | undefined, ceiling: number, name: string): number {
  if (value === undefined) return ceiling;
  if (!Number.isInteger(value) || value < 1 || value > ceiling) {
    throw new RangeError(`${name} must be an integer between 1 and ${ceiling}`);
  }
  return value;
}

function resolveLimits(options: AgentDocumentChunkOptions): ResolvedLimits {
  return {
    maxCharacters: resolveLimit(options.maxCharacters, TELEGRAM_RICH_MESSAGE_LIMITS.textCharacters, "maxCharacters"),
    maxBlocks: resolveLimit(options.maxBlocks, TELEGRAM_RICH_MESSAGE_LIMITS.blocks, "maxBlocks"),
    maxNesting: resolveLimit(options.maxNesting, TELEGRAM_RICH_MESSAGE_LIMITS.nesting, "maxNesting"),
    maxMedia: resolveLimit(options.maxMedia, TELEGRAM_RICH_MESSAGE_LIMITS.media, "maxMedia"),
    maxTableColumns: resolveLimit(options.maxTableColumns, TELEGRAM_RICH_MESSAGE_LIMITS.tableColumns, "maxTableColumns"),
  };
}

function captionCharacters(caption: AgentCaption | undefined): number {
  if (!caption) return 0;
  return inlineTelegramCharacterCount(caption.text) +
    (caption.credit === undefined ? 0 : inlineTelegramCharacterCount(caption.credit));
}

function addMetrics(left: AgentDocumentMetrics, right: AgentDocumentMetrics): AgentDocumentMetrics {
  return {
    characters: left.characters + right.characters,
    blocks: left.blocks + right.blocks,
    media: left.media + right.media,
  };
}

function metricsForBlocks(blocks: readonly AgentBlock[]): AgentDocumentMetrics {
  return blocks.reduce<AgentDocumentMetrics>(
    (total, block) => addMetrics(total, agentBlockMetrics(block)),
    { characters: 0, blocks: 0, media: 0 },
  );
}

export function agentBlockMetrics(block: AgentBlock): AgentDocumentMetrics {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "code":
    case "thinking":
    case "footer":
      return { characters: inlineTelegramCharacterCount(block.text), blocks: 1, media: 0 };
    case "pullquote":
      return {
        characters: inlineTelegramCharacterCount(block.text) +
          (block.credit === undefined ? 0 : inlineTelegramCharacterCount(block.credit)),
        blocks: 1,
        media: 0,
      };
    case "quote": {
      const content = block.blocks && block.blocks.length > 0
        ? addMetrics({ characters: 0, blocks: 1, media: 0 }, metricsForBlocks(block.blocks))
        : { characters: inlineTelegramCharacterCount(block.text), blocks: 1, media: 0 };
      return {
        ...content,
        characters: content.characters +
          (block.credit === undefined ? 0 : inlineTelegramCharacterCount(block.credit)),
      };
    }
    case "math":
      return { characters: unicodeLength(block.expression), blocks: 1, media: 0 };
    case "divider":
    case "anchor":
      return { characters: 0, blocks: 1, media: 0 };
    case "buttons":
      return { characters: unicodeLength(blockPlainText(block)), blocks: 1, media: 0 };
    case "list": {
      let result: AgentDocumentMetrics = { characters: 0, blocks: 1 + block.items.length, media: 0 };
      for (const item of block.items) result = addMetrics(result, metricsForBlocks(item.blocks));
      return result;
    }
    case "table": {
      const characters = block.cells.reduce(
        (total, row) => total + row.reduce(
          (rowTotal, cell) => rowTotal + (cell.text === undefined ? 0 : inlineTelegramCharacterCount(cell.text)),
          0,
        ),
        0,
      );
      return {
        characters: characters + captionCharacters(block.caption),
        blocks: 1 + block.cells.length,
        media: 0,
      };
    }
    case "details":
      return addMetrics(
        { characters: inlineTelegramCharacterCount(block.summary), blocks: 1, media: 0 },
        metricsForBlocks(block.blocks),
      );
    case "collage":
    case "slideshow": {
      const nested = metricsForBlocks(block.blocks);
      return {
        characters: nested.characters + captionCharacters(block.caption),
        blocks: 1 + nested.blocks,
        media: nested.media,
      };
    }
    case "photo":
    case "video":
    case "audio":
    case "animation":
    case "document":
    case "voice":
    case "voice_note":
      return { characters: captionCharacters(block.caption), blocks: 1, media: 1 };
    case "map":
      return { characters: captionCharacters(block.caption), blocks: 1, media: 0 };
  }
}

export function agentDocumentMetrics(document: AgentDocument): AgentDocumentMetrics {
  return metricsForBlocks(document.blocks);
}

function isInlineArray(value: AgentInline): value is readonly AgentInline[] {
  return Array.isArray(value);
}

function normalizeInline(value: AgentInline, depth: number, maxDepth: number): AgentInline {
  if (typeof value === "string") return value;
  if (isInlineArray(value)) return value.map((part) => normalizeInline(part, depth, maxDepth));
  if (depth >= maxDepth) return inlinePlainText(value);
  switch (value.type) {
    case "math":
    case "custom_emoji":
    case "anchor":
    case "button":
      return value;
    case "url":
      return { ...value, text: normalizeInline(value.text, depth + 1, maxDepth) };
    case "email":
      return { ...value, text: normalizeInline(value.text, depth + 1, maxDepth) };
    case "phone":
      return { ...value, text: normalizeInline(value.text, depth + 1, maxDepth) };
    case "mention":
      return { ...value, text: normalizeInline(value.text, depth + 1, maxDepth) };
    case "text_mention":
      return { ...value, text: normalizeInline(value.text, depth + 1, maxDepth) };
    default:
      return { ...value, text: normalizeInline(value.text, depth + 1, maxDepth) };
  }
}

function normalizeCaption(
  caption: AgentCaption | undefined,
  depth: number,
  maxDepth: number,
): AgentCaption | undefined {
  if (!caption) return undefined;
  return {
    text: normalizeInline(caption.text, depth, maxDepth),
    ...(caption.credit === undefined
      ? {}
      : { credit: normalizeInline(caption.credit, depth, maxDepth) }),
  };
}

function normalizeTableCell(
  cell: AgentTableCell,
  depth: number,
  maxDepth: number,
): AgentTableCell {
  return {
    ...cell,
    ...(cell.text === undefined ? {} : { text: normalizeInline(cell.text, depth, maxDepth) }),
  };
}

function normalizeBlock(block: AgentBlock, depth: number, limits: ResolvedLimits): AgentBlock {
  if (depth >= limits.maxNesting) {
    return { type: "paragraph", text: blockPlainText(block) };
  }
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "code":
    case "thinking":
    case "footer":
      return { ...block, text: normalizeInline(block.text, 1, limits.maxNesting) };
    case "pullquote":
      return {
        ...block,
        text: normalizeInline(block.text, 1, limits.maxNesting),
        ...(block.credit === undefined
          ? {}
          : { credit: normalizeInline(block.credit, 1, limits.maxNesting) }),
      };
    case "quote":
      return {
        ...block,
        text: normalizeInline(block.text, 1, limits.maxNesting),
        ...(block.credit === undefined
          ? {}
          : { credit: normalizeInline(block.credit, 1, limits.maxNesting) }),
        ...(block.blocks === undefined
          ? {}
          : { blocks: block.blocks.map((inner) => normalizeBlock(inner, depth + 1, limits)) }),
      };
    case "buttons":
      return { ...block, buttons: block.buttons.slice(0, 8) };
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          blocks: item.blocks.map((inner) => normalizeBlock(inner, depth + 1, limits)),
        })),
      };
    case "table":
      return {
        ...block,
        cells: block.cells.map((row) =>
          row.slice(0, limits.maxTableColumns).map((cell, index) => {
            const normalized = normalizeTableCell(cell, 1, limits.maxNesting);
            const remainingColumns = limits.maxTableColumns - index;
            return normalized.colspan !== undefined && normalized.colspan > remainingColumns
              ? { ...normalized, colspan: remainingColumns }
              : normalized;
          })),
        ...(block.caption === undefined
          ? {}
          : { caption: normalizeCaption(block.caption, 1, limits.maxNesting) }),
      } as AgentBlock;
    case "details":
      return {
        ...block,
        summary: normalizeInline(block.summary, 1, limits.maxNesting),
        blocks: block.blocks.map((inner) => normalizeBlock(inner, depth + 1, limits)),
      };
    case "collage":
    case "slideshow":
      return {
        ...block,
        blocks: block.blocks.map((inner) => normalizeBlock(inner, depth + 1, limits)),
        ...(block.caption === undefined
          ? {}
          : { caption: normalizeCaption(block.caption, 1, limits.maxNesting) }),
      } as AgentBlock;
    case "photo":
    case "video":
    case "audio":
    case "animation":
    case "document":
    case "voice":
    case "voice_note":
      return {
        ...block,
        ...(block.caption === undefined
          ? {}
          : { caption: normalizeCaption(block.caption, 1, limits.maxNesting) }),
      } as AgentBlock;
    case "map": {
      let width = block.width === undefined ? undefined : Math.min(10000, Math.max(0, Math.trunc(block.width)));
      let height = block.height === undefined ? undefined : Math.min(10000, Math.max(0, Math.trunc(block.height)));
      if (width !== undefined && height !== undefined && width > 0 && height > 0) {
        if (width + height > 10000) {
          const scale = 10000 / (width + height);
          width = Math.max(1, Math.floor(width * scale));
          height = Math.max(1, Math.floor(height * scale));
        }
        if (width / height > 20) width = Math.max(1, Math.floor(height * 20));
        if (height / width > 20) height = Math.max(1, Math.floor(width * 20));
      }
      return {
        ...block,
        ...(block.zoom === undefined
          ? {}
          : { zoom: Math.min(24, Math.max(0, Math.trunc(block.zoom))) }),
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height }),
        ...(block.caption === undefined
          ? {}
          : { caption: normalizeCaption(block.caption, 1, limits.maxNesting) }),
      } as AgentBlock;
    }
    case "math":
    case "divider":
    case "anchor":
      return block;
  }
}

export function normalizeAgentDocument(
  document: AgentDocument,
  options: AgentDocumentChunkOptions = {},
): AgentDocument {
  const limits = resolveLimits(options);
  return {
    blocks: document.blocks.map((block) => normalizeBlock(block, 1, limits)),
    ...(document.rtl === undefined ? {} : { rtl: document.rtl }),
  };
}

interface SegmenterLike {
  segment(value: string): Iterable<{ segment: string }>;
}

type SegmenterConstructor = new (
  locales?: string | readonly string[],
  options?: { granularity?: "grapheme" },
) => SegmenterLike;

function graphemes(value: string): string[] {
  const maybeIntl = Intl as unknown as { Segmenter?: SegmenterConstructor };
  if (maybeIntl.Segmenter) {
    return Array.from(
      new maybeIntl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (part) => part.segment,
    );
  }
  return Array.from(value);
}

function splitLongToken(value: string, maxCharacters: number): string[] {
  const output: string[] = [];
  let current = "";
  let currentLength = 0;
  for (const segment of graphemes(value)) {
    const length = unicodeLength(segment);
    if (currentLength > 0 && currentLength + length > maxCharacters) {
      output.push(current);
      current = "";
      currentLength = 0;
    }
    current += segment;
    currentLength += length;
  }
  if (current.length > 0) output.push(current);
  return output;
}

function splitNaturalText(value: string, maxCharacters: number): string[] {
  if (unicodeLength(value) <= maxCharacters) return [value];
  const tokens = value.match(/\S+\s*|\s+/gu) ?? [value];
  const output: string[] = [];
  let current = "";
  let currentLength = 0;
  for (const token of tokens) {
    const pieces = unicodeLength(token) > maxCharacters
      ? splitLongToken(token, maxCharacters)
      : [token];
    for (const piece of pieces) {
      const length = unicodeLength(piece);
      if (currentLength > 0 && currentLength + length > maxCharacters) {
        output.push(current);
        current = "";
        currentLength = 0;
      }
      current += piece;
      currentLength += length;
    }
  }
  if (current.length > 0) output.push(current);
  return output;
}

function splitCodeText(value: string, maxCharacters: number): string[] {
  if (unicodeLength(value) <= maxCharacters) return [value];
  const lines = value.split(/(?<=\n)/u);
  const output: string[] = [];
  let current = "";
  let currentLength = 0;
  for (const line of lines) {
    const pieces = unicodeLength(line) > maxCharacters
      ? splitLongToken(line, maxCharacters)
      : [line];
    for (const piece of pieces) {
      const length = unicodeLength(piece);
      if (currentLength > 0 && currentLength + length > maxCharacters) {
        output.push(current);
        current = "";
        currentLength = 0;
      }
      current += piece;
      currentLength += length;
    }
  }
  if (current.length > 0) output.push(current);
  return output;
}

function splitInline(value: AgentInline, maxCharacters: number): AgentInline[] {
  if (inlineTelegramCharacterCount(value) <= maxCharacters) return [value];
  if (typeof value === "string") return splitNaturalText(value, maxCharacters);
  if (isInlineArray(value)) {
    const result: AgentInline[] = [];
    let current: AgentInline[] = [];
    let currentLength = 0;
    for (const part of value) {
      for (const piece of splitInline(part, maxCharacters)) {
        const length = inlineTelegramCharacterCount(piece);
        if (currentLength > 0 && currentLength + length > maxCharacters) {
          result.push(current.length === 1 ? current[0]! : current);
          current = [];
          currentLength = 0;
        }
        current.push(piece);
        currentLength += length;
      }
    }
    if (current.length > 0) result.push(current.length === 1 ? current[0]! : current);
    return result;
  }
  if (value.type === "math") {
    return splitNaturalText(value.expression, maxCharacters)
      .map((text) => ({ type: "code", text }));
  }
  if (value.type === "custom_emoji") {
    return splitNaturalText(value.alternativeText, maxCharacters);
  }
  if (value.type === "directional_isolate") {
    if (maxCharacters <= 2) return splitInline(value.text, maxCharacters);
    return splitInline(value.text, maxCharacters - 2)
      .map((text) => ({ ...value, text }));
  }
  if (value.type === "anchor" || value.type === "button") {
    return [value];
  }
  return splitInline(value.text, maxCharacters).map((text) => ({ ...value, text }) as AgentInline);
}

function splitTextBlock(
  block: Extract<
    AgentBlock,
    { type: "paragraph" | "heading" | "code" | "quote" | "pullquote" | "thinking" | "footer" }
  >,
  maxCharacters: number,
): AgentBlock[] {
  const parts = block.type === "code" && typeof block.text === "string"
    ? splitCodeText(block.text, maxCharacters)
    : splitInline(block.text, maxCharacters);
  return parts.map((text) => ({ ...block, text }) as AgentBlock);
}

function fits(metrics: AgentDocumentMetrics, limits: ResolvedLimits): boolean {
  return metrics.characters <= limits.maxCharacters &&
    metrics.blocks <= limits.maxBlocks &&
    metrics.media <= limits.maxMedia;
}

function rowPlainText(row: readonly AgentTableCell[]): string {
  return row
    .map((cell) => (cell.text === undefined ? "" : inlinePlainText(cell.text)))
    .join(" | ");
}

function splitTable(block: Extract<AgentBlock, { type: "table" }>, limits: ResolvedLimits): AgentBlock[] {
  const output: AgentBlock[] = [];
  let rows: AgentTableCell[][] = [];
  let currentCharacters = 0;
  let currentBlocks = 1;
  const flush = () => {
    if (rows.length === 0) return;
    output.push({ ...block, cells: rows });
    rows = [];
    currentCharacters = 0;
    currentBlocks = 1;
  };
  for (const row of block.cells) {
    const rowCharacters = unicodeLength(rowPlainText(row));
    if (rowCharacters > limits.maxCharacters) {
      flush();
      for (const text of splitNaturalText(rowPlainText(row), limits.maxCharacters)) {
        output.push({ type: "paragraph", text });
      }
      continue;
    }
    if (
      rows.length > 0 &&
      (currentCharacters + rowCharacters > limits.maxCharacters ||
        currentBlocks + 1 > limits.maxBlocks)
    ) {
      flush();
    }
    rows.push([...row]);
    currentCharacters += rowCharacters;
    currentBlocks += 1;
  }
  flush();
  return output;
}

function splitList(block: Extract<AgentBlock, { type: "list" }>, limits: ResolvedLimits): AgentBlock[] {
  const expandedItems: AgentListItem[] = [];
  for (const item of block.items) {
    const itemDocuments = chunkAgentDocument(
      { blocks: item.blocks },
      {
        maxCharacters: limits.maxCharacters,
        maxBlocks: Math.max(1, limits.maxBlocks - 2),
        maxNesting: limits.maxNesting,
        maxMedia: limits.maxMedia,
        maxTableColumns: limits.maxTableColumns,
      },
    );
    for (const document of itemDocuments) expandedItems.push({ ...item, blocks: document.blocks });
  }

  const output: AgentBlock[] = [];
  let items: AgentListItem[] = [];
  let metrics: AgentDocumentMetrics = { characters: 0, blocks: 1, media: 0 };
  const flush = () => {
    if (items.length === 0) return;
    output.push({ type: "list", items });
    items = [];
    metrics = { characters: 0, blocks: 1, media: 0 };
  };
  for (const item of expandedItems) {
    const itemMetrics = addMetrics(
      { characters: 0, blocks: 1, media: 0 },
      metricsForBlocks(item.blocks),
    );
    const next = addMetrics(metrics, itemMetrics);
    if (items.length > 0 && !fits(next, limits)) flush();
    items.push(item);
    metrics = addMetrics(metrics, itemMetrics);
  }
  flush();
  return output;
}

function splitNestedBlock(
  block: Extract<AgentBlock, { type: "details" | "collage" | "slideshow" }>,
  limits: ResolvedLimits,
): AgentBlock[] {
  if (block.type === "details") {
    const overhead = inlineTelegramCharacterCount(block.summary);
    if (overhead >= limits.maxCharacters) {
      const summaryBlocks = splitInline(block.summary, limits.maxCharacters)
        .map((text): AgentBlock => ({ type: "paragraph", text }));
      const contentBlocks = chunkAgentDocument(
        { blocks: block.blocks },
        limits,
      ).flatMap((document) => document.blocks);
      return [...summaryBlocks, ...contentBlocks];
    }

    const nestedDocuments = chunkAgentDocument(
      { blocks: block.blocks },
      {
        maxCharacters: Math.max(1, limits.maxCharacters - overhead),
        maxBlocks: Math.max(1, limits.maxBlocks - 1),
        maxNesting: limits.maxNesting,
        maxMedia: limits.maxMedia,
        maxTableColumns: limits.maxTableColumns,
      },
    );
    return nestedDocuments.map((document) => ({ ...block, blocks: document.blocks }));
  }

  const captionFits = captionCharacters(block.caption) <= limits.maxCharacters;
  const overhead = captionFits ? captionCharacters(block.caption) : 0;
  const nestedDocuments = chunkAgentDocument(
    { blocks: block.blocks },
    {
      maxCharacters: Math.max(1, limits.maxCharacters - overhead),
      maxBlocks: Math.max(1, limits.maxBlocks - 1),
      maxNesting: limits.maxNesting,
      maxMedia: limits.maxMedia,
      maxTableColumns: limits.maxTableColumns,
    },
  );

  const wrappers = nestedDocuments.map((document, index): AgentBlock => ({
    type: block.type,
    blocks: document.blocks,
    ...(index === 0 && captionFits && block.caption !== undefined
      ? { caption: block.caption }
      : {}),
  }));

  if (captionFits || block.caption === undefined) return wrappers;

  const captionValue: AgentInline = block.caption.credit === undefined
    ? block.caption.text
    : [block.caption.text, "\n", block.caption.credit];
  const captionBlocks = splitInline(captionValue, limits.maxCharacters)
    .map((text): AgentBlock => ({ type: "paragraph", text }));
  return [...wrappers, ...captionBlocks];
}

function splitCaptionedBlock(
  block: Extract<
    AgentBlock,
    { type: "photo" | "video" | "audio" | "animation" | "document" | "voice" | "voice_note" | "map" }
  >,
  limits: ResolvedLimits,
): AgentBlock[] {
  if (!block.caption || captionCharacters(block.caption) <= limits.maxCharacters) return [block];

  const creditCharacters = block.caption.credit === undefined
    ? 0
    : unicodeLength(inlinePlainText(block.caption.credit));
  const textBudget = Math.max(1, limits.maxCharacters - creditCharacters);
  const pieces = splitInline(block.caption.text, textBudget);
  const firstText = pieces[0] ?? "";
  const canKeepCredit = block.caption.credit !== undefined &&
    unicodeLength(inlinePlainText(firstText)) + creditCharacters <= limits.maxCharacters;

  const firstCaption: AgentCaption = {
    text: firstText,
    ...(canKeepCredit ? { credit: block.caption.credit } : {}),
  };
  const first = { ...block, caption: firstCaption } as AgentBlock;
  const overflow: AgentBlock[] = pieces.slice(1)
    .map((text): AgentBlock => ({ type: "paragraph", text }));

  if (block.caption.credit !== undefined && !canKeepCredit) {
    overflow.push(
      ...splitInline(block.caption.credit, limits.maxCharacters)
        .map((text): AgentBlock => ({ type: "paragraph", text })),
    );
  }
  return [first, ...overflow];
}

function splitQuote(
  block: Extract<AgentBlock, { type: "quote" }>,
  limits: ResolvedLimits,
): AgentBlock[] {
  if (!block.blocks || block.blocks.length === 0 || block.expandable) {
    return splitTextBlock(block, limits.maxCharacters);
  }
  const nested = chunkAgentDocument(
    { blocks: block.blocks },
    {
      maxCharacters: limits.maxCharacters,
      maxBlocks: Math.max(1, limits.maxBlocks - 1),
      maxNesting: limits.maxNesting,
      maxMedia: limits.maxMedia,
      maxTableColumns: limits.maxTableColumns,
    },
  );
  return nested.map((document): AgentBlock => ({
    ...block,
    text: "",
    blocks: document.blocks,
  }));
}

function splitBlock(block: AgentBlock, limits: ResolvedLimits): AgentBlock[] {
  const metrics = agentBlockMetrics(block);
  if (fits(metrics, limits)) return [block];

  switch (block.type) {
    case "paragraph":
    case "heading":
    case "code":
    case "pullquote":
    case "thinking":
    case "footer":
      return splitTextBlock(block, limits.maxCharacters);
    case "quote":
      return splitQuote(block, limits);
    case "math":
      return splitCodeText(block.expression, limits.maxCharacters)
        .map((text) => ({ type: "code", text, language: "latex" }));
    case "list":
      return splitList(block, limits);
    case "table":
      return splitTable(block, limits);
    case "details":
    case "collage":
    case "slideshow":
      return splitNestedBlock(block, limits);
    case "photo":
    case "video":
    case "audio":
    case "animation":
    case "document":
    case "voice":
    case "voice_note":
    case "map":
      return splitCaptionedBlock(block, limits);
    case "buttons":
      return splitNaturalText(blockPlainText(block), limits.maxCharacters)
        .map((text): AgentBlock => ({ type: "paragraph", text }));
    case "divider":
    case "anchor":
      return [block];
  }
}

export function chunkAgentDocument(
  document: AgentDocument,
  options: AgentDocumentChunkOptions = {},
): AgentDocument[] {
  const limits = resolveLimits(options);
  const normalized = normalizeAgentDocument(document, options);
  const pieces = normalized.blocks.flatMap((block) => splitBlock(block, limits));
  if (pieces.length === 0) return [];

  const documents: AgentDocument[] = [];
  let blocks: AgentBlock[] = [];
  let metrics: AgentDocumentMetrics = { characters: 0, blocks: 0, media: 0 };
  const flush = () => {
    if (blocks.length === 0) return;
    documents.push({
      blocks,
      ...(normalized.rtl === undefined ? {} : { rtl: normalized.rtl }),
    });
    blocks = [];
    metrics = { characters: 0, blocks: 0, media: 0 };
  };

  for (const block of pieces) {
    const blockMetrics = agentBlockMetrics(block);
    const next = addMetrics(metrics, blockMetrics);
    if (blocks.length > 0 && !fits(next, limits)) flush();
    blocks.push(block);
    metrics = addMetrics(metrics, blockMetrics);
  }
  flush();
  return documents;
}
