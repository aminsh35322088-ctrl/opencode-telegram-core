import type { InputRichMessageWithoutUpload } from "grammy/types";
import type { AgentBlock, AgentDocument } from "./agent-document.js";

type DraftBlock = NonNullable<InputRichMessageWithoutUpload["blocks"]>[number];

function compileBlock(block: AgentBlock, allowThinking: boolean): DraftBlock | null {
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", text: block.text };
    case "heading":
      return { type: "heading", text: block.text, size: block.level };
    case "code": {
      const result: DraftBlock = { type: "pre", text: block.text };
      if (block.language) {
        (result as { language?: string }).language = block.language;
      }
      return result;
    }
    case "quote":
      return block.expandable
        ? { type: "expandable_blockquote", text: block.text }
        : { type: "blockquote", blocks: [{ type: "paragraph", text: block.text }] };
    case "math":
      return { type: "mathematical_expression", expression: block.expression };
    case "divider":
      return { type: "divider" };
    case "thinking":
      return allowThinking ? { type: "thinking", text: block.text } : null;
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
