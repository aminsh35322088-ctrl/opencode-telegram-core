import type {
  AgentBlock,
  AgentCaption,
  AgentDocument,
  AgentTableCell,
} from "./agent-document.js";
import type { AgentInline } from "./agent-inline.js";

export type AgentBaseDirection = "ltr" | "rtl" | "neutral";

const BIDI_CONTROL_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
const RTL_STRONG_RE = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/u;
const LETTER_RE = /\p{Letter}/u;
const ASCII_DIGIT_RE = /[0-9]/u;

interface DirectionStats {
  rtl: number;
  ltr: number;
  first: Exclude<AgentBaseDirection, "neutral"> | null;
}

function emptyStats(): DirectionStats {
  return { rtl: 0, ltr: 0, first: null };
}

function addStats(target: DirectionStats, source: DirectionStats): void {
  if (target.first === null && source.first !== null) target.first = source.first;
  target.rtl += source.rtl;
  target.ltr += source.ltr;
}

export function stripBidiControls(value: string): string {
  return value.replace(BIDI_CONTROL_RE, "");
}

function classifyStrong(character: string): AgentBaseDirection {
  if (RTL_STRONG_RE.test(character)) return "rtl";
  if (ASCII_DIGIT_RE.test(character) || LETTER_RE.test(character)) return "ltr";
  return "neutral";
}

function statsForText(value: string): DirectionStats {
  const stats = emptyStats();
  for (const character of stripBidiControls(value)) {
    const direction = classifyStrong(character);
    if (direction === "neutral") continue;
    if (stats.first === null) stats.first = direction;
    if (direction === "rtl") stats.rtl += 1;
    else stats.ltr += 1;
  }
  return stats;
}

function directionFromStats(stats: DirectionStats): AgentBaseDirection {
  if (stats.rtl === 0 && stats.ltr === 0) return "neutral";
  if (stats.rtl === 0) return "ltr";
  if (stats.ltr === 0) return "rtl";

  const total = stats.rtl + stats.ltr;
  const rtlShare = stats.rtl / total;
  if (rtlShare >= 0.5) return "rtl";
  if (rtlShare <= 0.35) return "ltr";
  return stats.first ?? "ltr";
}

function naturalStatsForText(value: string): DirectionStats {
  const stats = emptyStats();
  for (const token of stripBidiControls(value).split(/\s+/u)) {
    if (token.length === 0) continue;
    const tokenStats = statsForText(token);
    const direction = directionFromStats(tokenStats);
    if (direction === "neutral") continue;
    if (stats.first === null) stats.first = direction;
    if (direction === "rtl") stats.rtl += 1;
    else stats.ltr += 1;
  }
  return stats;
}

export function detectTextDirection(value: string): AgentBaseDirection {
  return directionFromStats(naturalStatsForText(value));
}

function isInlineArray(value: AgentInline): value is readonly AgentInline[] {
  return Array.isArray(value);
}

function naturalStatsForInline(value: AgentInline): DirectionStats {
  if (typeof value === "string") return naturalStatsForText(value);
  if (isInlineArray(value)) {
    const stats = emptyStats();
    for (const part of value) addStats(stats, naturalStatsForInline(part));
    return stats;
  }

  switch (value.type) {
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "spoiler":
    case "subscript":
    case "superscript":
    case "marked":
    case "directional_isolate":
    case "reference":
    case "reference_link":
      return naturalStatsForInline(value.text);
    case "code":
    case "math":
    case "date_time":
    case "url":
    case "telegram_user_link":
    case "email":
    case "phone":
    case "bank_card":
    case "mention":
    case "text_mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
    case "anchor":
    case "anchor_link":
    case "button":
    case "custom_emoji":
      return emptyStats();
  }
}

function allStatsForInline(value: AgentInline): DirectionStats {
  if (typeof value === "string") return statsForText(value);
  if (isInlineArray(value)) {
    const stats = emptyStats();
    for (const part of value) addStats(stats, allStatsForInline(part));
    return stats;
  }

  if (value.type === "math") return statsForText(value.expression);
  if (value.type === "custom_emoji" || value.type === "anchor" || value.type === "button") {
    return emptyStats();
  }
  return allStatsForInline(value.text);
}

function captionStats(caption: AgentCaption | undefined): DirectionStats {
  const stats = emptyStats();
  if (!caption) return stats;
  addStats(stats, naturalStatsForInline(caption.text));
  if (caption.credit !== undefined) addStats(stats, naturalStatsForInline(caption.credit));
  return stats;
}

function blockNaturalStats(block: AgentBlock): DirectionStats {
  const stats = emptyStats();
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "thinking":
    case "footer":
      addStats(stats, naturalStatsForInline(block.text));
      break;
    case "pullquote":
      addStats(stats, naturalStatsForInline(block.text));
      if (block.credit !== undefined) addStats(stats, naturalStatsForInline(block.credit));
      break;
    case "quote":
      if (block.blocks && block.blocks.length > 0) {
        for (const nested of block.blocks) addStats(stats, blockNaturalStats(nested));
      } else {
        addStats(stats, naturalStatsForInline(block.text));
      }
      if (block.credit !== undefined) addStats(stats, naturalStatsForInline(block.credit));
      break;
    case "list":
      for (const item of block.items) {
        for (const nested of item.blocks) addStats(stats, blockNaturalStats(nested));
      }
      break;
    case "table":
      for (const row of block.cells) {
        for (const cell of row) {
          if (cell.text !== undefined) addStats(stats, naturalStatsForInline(cell.text));
        }
      }
      addStats(stats, captionStats(block.caption));
      break;
    case "details":
      addStats(stats, naturalStatsForInline(block.summary));
      for (const nested of block.blocks) addStats(stats, blockNaturalStats(nested));
      break;
    case "collage":
    case "slideshow":
      for (const nested of block.blocks) addStats(stats, blockNaturalStats(nested));
      addStats(stats, captionStats(block.caption));
      break;
    case "photo":
    case "video":
    case "audio":
    case "animation":
    case "document":
    case "voice":
    case "voice_note":
    case "map":
      addStats(stats, captionStats(block.caption));
      break;
    case "code":
    case "math":
    case "divider":
    case "anchor":
    case "buttons":
      break;
  }
  return stats;
}

export function detectDocumentDirection(document: AgentDocument): AgentBaseDirection {
  const stats = emptyStats();
  for (const block of document.blocks) addStats(stats, blockNaturalStats(block));
  return directionFromStats(stats);
}

function concatInline(parts: readonly AgentInline[]): AgentInline {
  const output: AgentInline[] = [];
  const append = (part: AgentInline): void => {
    if (isInlineArray(part)) {
      for (const nested of part) append(nested);
      return;
    }
    const previous = output.at(-1);
    if (typeof previous === "string" && typeof part === "string") {
      output[output.length - 1] = previous + part;
    } else if (typeof part !== "string" || part.length > 0) {
      output.push(part);
    }
  };
  for (const part of parts) append(part);
  if (output.length === 0) return "";
  return output.length === 1 ? output[0]! : output;
}

function isolate(direction: "ltr" | "rtl", value: AgentInline): AgentInline {
  return { type: "directional_isolate", direction, text: value };
}

function isolateToken(token: string, base: "ltr" | "rtl"): AgentInline {
  const clean = stripBidiControls(token);
  if (clean.length === 0) return "";

  const tokenDirection = detectTextDirection(clean);
  if (tokenDirection === "neutral") return clean;

  const strongDirections = new Set<"ltr" | "rtl">();
  for (const character of clean) {
    const direction = classifyStrong(character);
    if (direction === "ltr" || direction === "rtl") strongDirections.add(direction);
  }
  if (strongDirections.size === 1) {
    return tokenDirection === base ? clean : isolate(tokenDirection, clean);
  }

  const runs: Array<{ direction: "ltr" | "rtl"; text: string }> = [];
  let currentDirection: "ltr" | "rtl" | null = null;
  let current = "";
  let leadingNeutral = "";

  const flush = (): void => {
    if (currentDirection !== null && current.length > 0) {
      runs.push({ direction: currentDirection, text: current });
    }
    currentDirection = null;
    current = "";
  };

  for (const character of clean) {
    const direction = classifyStrong(character);
    if (direction === "neutral") {
      if (currentDirection === null) leadingNeutral += character;
      else current += character;
      continue;
    }
    if (currentDirection === null) {
      currentDirection = direction;
      current = leadingNeutral + character;
      leadingNeutral = "";
      continue;
    }
    if (direction === currentDirection) {
      current += character;
      continue;
    }
    flush();
    currentDirection = direction;
    current = character;
  }

  flush();
  if (leadingNeutral.length > 0) {
    if (runs.length === 0) return leadingNeutral;
    runs[runs.length - 1]!.text += leadingNeutral;
  }

  return concatInline(runs.map((run) =>
    run.direction === base ? run.text : isolate(run.direction, run.text)));
}

function isolatePlainText(value: string, base: "ltr" | "rtl"): AgentInline {
  const clean = stripBidiControls(value);
  const parts = clean.split(/(\s+)/u);
  return concatInline(parts.map((part) =>
    /^\s+$/u.test(part) || part.length === 0 ? part : isolateToken(part, base)));
}

function inlineDirection(value: AgentInline): AgentBaseDirection {
  return directionFromStats(allStatsForInline(value));
}

function wrapSemanticIfNeeded(
  value: AgentInline,
  base: "ltr" | "rtl",
  preferred: "ltr" | "rtl" | null = null,
): AgentInline {
  const direction = preferred ?? inlineDirection(value);
  if (direction === "neutral" || direction === base) return value;
  return isolate(direction, value);
}

function optimizeInline(value: AgentInline, base: "ltr" | "rtl"): AgentInline {
  if (typeof value === "string") return isolatePlainText(value, base);
  if (isInlineArray(value)) return concatInline(value.map((part) => optimizeInline(part, base)));

  switch (value.type) {
    case "directional_isolate":
      return value;
    case "code":
    case "math":
    case "email":
    case "phone":
    case "bank_card":
    case "bot_command":
      return wrapSemanticIfNeeded(value, base, "ltr");
    case "url":
    case "telegram_user_link":
    case "date_time":
    case "mention":
    case "text_mention":
    case "hashtag":
    case "cashtag": {
      const optimized = { ...value, text: optimizeInline(value.text, base) } as AgentInline;
      const direction = inlineDirection(value.text);
      return wrapSemanticIfNeeded(optimized, base, direction === "neutral" ? "ltr" : direction);
    }
    case "anchor_link":
    case "reference":
    case "reference_link":
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "spoiler":
    case "subscript":
    case "superscript":
    case "marked":
      return { ...value, text: optimizeInline(value.text, base) } as AgentInline;
    case "anchor":
    case "button":
    case "custom_emoji":
      return value;
  }
}

function optimizeCaption(
  caption: AgentCaption | undefined,
  base: "ltr" | "rtl",
): AgentCaption | undefined {
  if (!caption) return undefined;
  return {
    text: optimizeInline(caption.text, base),
    ...(caption.credit === undefined ? {} : { credit: optimizeInline(caption.credit, base) }),
  };
}

function optimizeTableCell(
  cell: AgentTableCell,
  base: "ltr" | "rtl",
): AgentTableCell {
  if (cell.text === undefined) return cell;
  const direction = inlineDirection(cell.text);
  return {
    ...cell,
    text: optimizeInline(cell.text, base),
    ...(cell.align !== undefined
      ? {}
      : direction === "rtl"
        ? { align: "right" as const }
        : direction === "ltr"
          ? { align: "left" as const }
          : {}),
  };
}

function optimizeBlock(block: AgentBlock, base: "ltr" | "rtl"): AgentBlock {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "thinking":
    case "footer":
      return { ...block, text: optimizeInline(block.text, base) };
    case "code":
    case "math":
    case "divider":
    case "anchor":
    case "buttons":
      return block;
    case "pullquote":
      return {
        ...block,
        text: optimizeInline(block.text, base),
        ...(block.credit === undefined ? {} : { credit: optimizeInline(block.credit, base) }),
      };
    case "quote":
      return {
        ...block,
        text: optimizeInline(block.text, base),
        ...(block.credit === undefined ? {} : { credit: optimizeInline(block.credit, base) }),
        ...(block.blocks === undefined
          ? {}
          : { blocks: block.blocks.map((nested) => optimizeBlock(nested, base)) }),
      };
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          blocks: item.blocks.map((nested) => optimizeBlock(nested, base)),
        })),
      };
    case "table":
      return {
        ...block,
        cells: block.cells.map((row) => row.map((cell) => optimizeTableCell(cell, base))),
        ...(block.caption === undefined ? {} : { caption: optimizeCaption(block.caption, base)! }),
      } as AgentBlock;
    case "details":
      return {
        ...block,
        summary: optimizeInline(block.summary, base),
        blocks: block.blocks.map((nested) => optimizeBlock(nested, base)),
      };
    case "collage":
    case "slideshow":
      return {
        ...block,
        blocks: block.blocks.map((nested) => optimizeBlock(nested, base)),
        ...(block.caption === undefined ? {} : { caption: optimizeCaption(block.caption, base) }),
      } as AgentBlock;
    case "photo":
    case "video":
    case "audio":
    case "animation":
    case "document":
    case "voice":
    case "voice_note":
    case "map":
      return {
        ...block,
        ...(block.caption === undefined ? {} : { caption: optimizeCaption(block.caption, base) }),
      } as AgentBlock;
  }
}

export interface OptimizeAgentDocumentBidiOptions {
  readonly direction?: "auto" | "ltr" | "rtl";
}

export function optimizeAgentDocumentBidi(
  document: AgentDocument,
  options: OptimizeAgentDocumentBidiOptions = {},
): AgentDocument {
  const requested = options.direction ?? "auto";
  const detected = document.rtl === true
    ? "rtl"
    : document.rtl === false
      ? "ltr"
      : detectDocumentDirection(document);
  const base = requested === "auto"
    ? (detected === "neutral" ? "ltr" : detected)
    : requested;

  return {
    blocks: document.blocks.map((block) => optimizeBlock(block, base)),
    ...(document.rtl !== undefined
      ? { rtl: document.rtl }
      : base === "rtl"
        ? { rtl: true }
        : {}),
  };
}

export function detectMarkdownDirection(markdown: string): AgentBaseDirection {
  let inFence = false;
  let fence = "";
  const prose: string[] = [];

  for (const line of markdown.split(/\r?\n/u)) {
    const marker = line.match(/^\s*(\x60{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!inFence) {
        inFence = true;
        fence = marker[0]!;
      } else if (marker[0] === fence) {
        inFence = false;
        fence = "";
      }
      continue;
    }
    if (inFence) continue;
    prose.push(
      line
        .replace(/\x60[^\x60]*\x60/gu, " ")
        .replace(/https?:\/\/\S+/giu, " "),
    );
  }

  return detectTextDirection(prose.join("\n"));
}

export const BIDI_ISOLATE = {
  LRI: "\u2066",
  RLI: "\u2067",
  FSI: "\u2068",
  PDI: "\u2069",
} as const;
