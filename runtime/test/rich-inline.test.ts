import { describe, expect, test } from "bun:test";
import {
  renderTelegramRichDocument,
  renderTelegramRichMarkdown,
  type AgentDocument,
  type AgentInline,
} from "../src/index.js";

function richTextOf(message: unknown): unknown {
  const blocks = (message as { blocks?: Array<{ text?: unknown }> }).blocks ?? [];
  return blocks.length > 0 ? blocks[0]?.text : undefined;
}


describe("inline rich text tree", () => {
  test("a plain string block stays a plain string, not a wrapper node", () => {
    const document: AgentDocument = { blocks: [{ type: "paragraph", text: "hello" }] };
    const rendered = renderTelegramRichDocument(document, { draft: false });
    expect(richTextOf(rendered)).toBe("hello");
  });

  test("a string still typechecks everywhere text was previously required", () => {
    const document: AgentDocument = {
      blocks: [
        { type: "paragraph", text: "p" },
        { type: "heading", text: "h", level: 2 },
        { type: "code", text: "c", language: "ts" },
        { type: "quote", text: "q" },
        { type: "thinking", text: "t" },
      ],
    };
    // Thinking is draft-only, so a final render drops it; the other four
    // must survive, proving every legacy text field still accepts a string.
    const final = renderTelegramRichDocument(document, { draft: false }).blocks ?? [];
    expect(final.map((block) => block?.type)).toEqual([
      "paragraph",
      "heading",
      "pre",
      "blockquote",
    ]);
    const draft = renderTelegramRichDocument(document, { draft: true }).blocks ?? [];
    expect(draft).toHaveLength(5);
  });

  test("bold and italic nest into the recursive shape", () => {
    const inline: AgentInline = [
      "plain ",
      { type: "bold", text: "strong" },
      " and ",
      { type: "italic", text: "emphasis" },
    ];
    const document: AgentDocument = { blocks: [{ type: "paragraph", text: inline }] };
    expect(richTextOf(renderTelegramRichDocument(document, { draft: false }))).toEqual([
      "plain ",
      { type: "bold", text: "strong" },
      " and ",
      { type: "italic", text: "emphasis" },
    ]);
  });

  test("inline nodes nest to arbitrary depth", () => {
    const inline: AgentInline = {
      type: "bold",
      text: ["a", { type: "underline", text: { type: "italic", text: "deep" } }],
    };
    const document: AgentDocument = { blocks: [{ type: "paragraph", text: inline }] };
    expect(richTextOf(renderTelegramRichDocument(document, { draft: false }))).toEqual({
      type: "bold",
      text: ["a", { type: "underline", text: { type: "italic", text: "deep" } }],
    });
  });

  test("every passthrough style maps to its Bot API node name", () => {
    const styles = [
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "spoiler",
      "subscript",
      "superscript",
      "marked",
      "code",
    ] as const;
    for (const style of styles) {
      const document: AgentDocument = {
        blocks: [{ type: "paragraph", text: { type: style, text: "x" } }],
      };
      expect(richTextOf(renderTelegramRichDocument(document, { draft: false }))).toEqual({
        type: style,
        text: "x",
      });
    }
  });

  test("url, email and phone carry their payload field", () => {
    const cases: Array<[AgentInline, Record<string, unknown>]> = [
      [{ type: "url", text: "site", url: "https://example.com" }, { type: "url", text: "site", url: "https://example.com" }],
      [{ type: "email", text: "mail", email: "a@b.c" }, { type: "email_address", text: "mail", email_address: "a@b.c" }],
      [{ type: "phone", text: "call", phone: "+100" }, { type: "phone_number", text: "call", phone_number: "+100" }],
    ];
    for (const [inline, expected] of cases) {
      const document: AgentDocument = { blocks: [{ type: "paragraph", text: inline }] };
      expect(richTextOf(renderTelegramRichDocument(document, { draft: false }))).toEqual(expected);
    }
  });

  test("mentions carry a username, or a full user for a text mention", () => {
    const mention: AgentDocument = {
      blocks: [{ type: "paragraph", text: { type: "mention", text: "@ada", username: "ada" } }],
    };
    const user = { id: 42, is_bot: false, first_name: "Ada" } as const;
    const textMention: AgentDocument = {
      blocks: [{ type: "paragraph", text: { type: "text_mention", text: "@ada", user } }],
    };
    expect(richTextOf(renderTelegramRichDocument(mention, { draft: false }))).toEqual({
      type: "mention",
      text: "@ada",
      username: "ada",
    });
    expect(richTextOf(renderTelegramRichDocument(textMention, { draft: false }))).toEqual({
      type: "text_mention",
      text: "@ada",
      user,
    });
  });

  test("custom emoji uses the id plus alternative_text", () => {
    const document: AgentDocument = {
      blocks: [{ type: "paragraph", text: { type: "custom_emoji", customEmojiId: "5", alternativeText: "👍" } }],
    };
    expect(richTextOf(renderTelegramRichDocument(document, { draft: false }))).toEqual({
      type: "custom_emoji",
      custom_emoji_id: "5",
      alternative_text: "👍",
    });
  });

  test("inline math is an expression node, not nested text", () => {
    const document: AgentDocument = {
      blocks: [{ type: "paragraph", text: { type: "math", expression: "x^2" } }],
    };
    expect(richTextOf(renderTelegramRichDocument(document, { draft: false }))).toEqual({
      type: "mathematical_expression",
      expression: "x^2",
    });
  });

  test("headings, code, quotes and thinking all accept the inline tree", () => {
    const inline: AgentInline = ["see ", { type: "code", text: "npm test" }];
    const document: AgentDocument = {
      blocks: [
        { type: "heading", text: inline, level: 3 },
        { type: "code", text: inline, language: "bash" },
        { type: "quote", text: inline, expandable: true },
        { type: "thinking", text: inline },
      ],
    };
    const blocks = renderTelegramRichDocument(document, { draft: true }).blocks ?? [];
    expect(blocks.map((b) => b?.type)).toEqual(["heading", "pre", "expandable_blockquote", "thinking"]);
    expect((blocks[0] as { text: unknown }).text).toEqual(inline);
  });

  test("inline content survives inside the blockquote branch too", () => {
    const inline: AgentInline = { type: "bold", text: "quoted" };
    const document: AgentDocument = { blocks: [{ type: "quote", text: inline }] };
    const blocks = renderTelegramRichDocument(document, { draft: false }).blocks ?? [];
    const quote = blocks[0] as { blocks: Array<{ text: unknown }> };
    expect(quote.blocks[0]?.text).toEqual({ type: "bold", text: "quoted" });
  });

  test("thinking blocks are dropped from the final message but kept in drafts", () => {
    const document: AgentDocument = {
      blocks: [
        { type: "thinking", text: "reasoning" },
        { type: "paragraph", text: "answer" },
      ],
    };
    const draft = renderTelegramRichDocument(document, { draft: true });
    const final = renderTelegramRichDocument(document, { draft: false });
    expect((draft.blocks ?? []).map((b) => b?.type)).toEqual(["thinking", "paragraph"]);
    expect((final.blocks ?? []).map((b) => b?.type)).toEqual(["paragraph"]);
  });

  test("the markdown path is untouched by the inline tree", () => {
    expect(renderTelegramRichMarkdown("# hi").markdown).toBe("# hi");
    expect(renderTelegramRichMarkdown("# hi", { rtl: true }).is_rtl).toBe(true);
  });
});
