import { describe, expect, test } from "bun:test";
import {
  agentDocumentMetrics,
  chunkAgentDocument,
  inlinePlainText,
  normalizeAgentDocument,
  parseMarkdownDocument,
  renderTelegramRichDocument,
  type AgentDocument,
} from "../src/index.js";

describe("Markdown to Telegram semantic document", () => {
  test("parses headings, inline styles and fenced code into native blocks", () => {
    const document = parseMarkdownDocument(
      "# Title\n\nUse **strong**, *emphasis*, and `code`.\n\n```typescript\nconst ok = true;\n```",
    );

    expect(document.blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "code",
    ]);

    const heading = document.blocks[0];
    const paragraph = document.blocks[1];
    const code = document.blocks[2];
    expect(heading).toMatchObject({ type: "heading", level: 1, text: "Title" });
    expect(paragraph).toMatchObject({ type: "paragraph" });
    expect(inlinePlainText(paragraph!.type === "paragraph" ? paragraph.text : "")).toBe(
      "Use strong, emphasis, and code.",
    );
    expect(code).toEqual({
      type: "code",
      text: "const ok = true;",
      language: "typescript",
    });

    const rendered = renderTelegramRichDocument(document, { draft: false });
    expect(rendered.blocks?.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "pre",
    ]);
    expect((rendered.blocks?.[2] as { language?: string } | undefined)?.language).toBe(
      "typescript",
    );
  });

  test("parses GFM tables, task lists and ordered values", () => {
    const document = parseMarkdownDocument(
      "| Name | State |\n|:-----|------:|\n| core | ready |\n\n- [x] shipped\n- [ ] pending\n\n3. three\n4. four",
    );

    const table = document.blocks[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("expected table");
    expect(table.cells[0]?.[0]).toMatchObject({ isHeader: true, align: "left" });
    expect(table.cells[0]?.[1]).toMatchObject({ isHeader: true, align: "right" });

    const tasks = document.blocks[1];
    expect(tasks?.type).toBe("list");
    if (tasks?.type !== "list") throw new Error("expected task list");
    expect(tasks.items[0]).toMatchObject({ hasCheckbox: true, isChecked: true });
    expect(tasks.items[1]).toMatchObject({ hasCheckbox: true, isChecked: false });

    const ordered = document.blocks[2];
    expect(ordered?.type).toBe("list");
    if (ordered?.type !== "list") throw new Error("expected ordered list");
    expect(ordered.items.map((item) => item.value)).toEqual([3, 4]);
  });

  test("drops unsafe link wrappers while preserving visible text", () => {
    const document = parseMarkdownDocument(
      "[safe](https://example.com) [telegram](tg://user?id=42) [script](javascript:alert(1))",
    );
    const paragraph = document.blocks[0];
    expect(paragraph?.type).toBe("paragraph");
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");

    const rendered = renderTelegramRichDocument(document, { draft: false });
    const text = (rendered.blocks?.[0] as { text?: unknown } | undefined)?.text;
    expect(JSON.stringify(text)).toContain("https://example.com");
    expect(JSON.stringify(text)).not.toContain("tg://user");
    expect(JSON.stringify(text)).not.toContain("javascript:");
    expect(inlinePlainText(paragraph.text)).toContain("telegram");
    expect(inlinePlainText(paragraph.text)).toContain("script");
  });

  test("treats raw HTML from model output as literal content", () => {
    const document = parseMarkdownDocument("<script>alert(1)</script>\n\n<b>hello</b>");
    expect(document.blocks.every((block) => block.type === "paragraph")).toBe(true);
    expect(document.blocks.map((block) => {
      if (block.type !== "paragraph") return "";
      return inlinePlainText(block.text);
    }).join("\n")).toContain("<script>alert(1)</script>");
  });
});

describe("Telegram-native document normalization and chunking", () => {
  test("splits long prose within the configured character budget", () => {
    const source: AgentDocument = {
      blocks: [{ type: "paragraph", text: "alpha beta gamma delta epsilon zeta eta theta" }],
    };
    const chunks = chunkAgentDocument(source, { maxCharacters: 12, maxBlocks: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(agentDocumentMetrics(chunk).characters).toBeLessThanOrEqual(12);
    }
    expect(
      chunks.flatMap((chunk) => chunk.blocks)
        .map((block) => block.type === "paragraph" ? inlinePlainText(block.text) : "")
        .join(""),
    ).toBe("alpha beta gamma delta epsilon zeta eta theta");
  });

  test("splits code by line while preserving the language hint", () => {
    const source: AgentDocument = {
      blocks: [{
        type: "code",
        language: "typescript",
        text: "const a = 1;\nconst b = 2;\nconst c = 3;\n",
      }],
    };
    const chunks = chunkAgentDocument(source, { maxCharacters: 16, maxBlocks: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    const codeBlocks = chunks.flatMap((chunk) => chunk.blocks);
    expect(codeBlocks.every((block) => block.type === "code")).toBe(true);
    expect(
      codeBlocks.every((block) => block.type !== "code" || block.language === "typescript"),
    ).toBe(true);
    expect(
      codeBlocks.map((block) => block.type === "code" ? inlinePlainText(block.text) : "").join(""),
    ).toBe("const a = 1;\nconst b = 2;\nconst c = 3;\n");
  });

  test("never splits inside an emoji grapheme cluster", () => {
    const family = "👨‍👩‍👧‍👦";
    const source: AgentDocument = {
      blocks: [{ type: "paragraph", text: family.repeat(4) }],
    };
    const chunks = chunkAgentDocument(source, { maxCharacters: 8, maxBlocks: 10 });
    const pieces = chunks.flatMap((chunk) => chunk.blocks)
      .map((block) => block.type === "paragraph" ? inlinePlainText(block.text) : "");

    expect(pieces.join("")).toBe(family.repeat(4));
    expect(pieces.every((piece) => !piece.startsWith("\u200d") && !piece.endsWith("\u200d"))).toBe(true);
  });

  test("clamps tables to Telegram's configured column limit", () => {
    const source: AgentDocument = {
      blocks: [{
        type: "table",
        cells: [
          Array.from({ length: 25 }, (_, index) => ({ text: String(index), isHeader: true })),
          Array.from({ length: 25 }, (_, index) => ({ text: "v" + index })),
        ],
      }],
    };
    const normalized = normalizeAgentDocument(source, { maxTableColumns: 20 });
    const table = normalized.blocks[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("expected table");
    expect(table.cells[0]?.length).toBe(20);
    expect(table.cells[1]?.length).toBe(20);
  });

  test("flattens content that exceeds the configured nesting depth", () => {
    const source: AgentDocument = {
      blocks: [{
        type: "details",
        summary: "outer",
        blocks: [{
          type: "details",
          summary: "inner",
          blocks: [{ type: "paragraph", text: { type: "bold", text: "deep" } }],
        }],
      }],
    };

    const normalized = normalizeAgentDocument(source, { maxNesting: 2 });
    const outer = normalized.blocks[0];
    expect(outer?.type).toBe("details");
    if (outer?.type !== "details") throw new Error("expected details");
    expect(outer.blocks[0]).toEqual({ type: "paragraph", text: "inner\ndeep" });
  });

  test("all chunks obey supplied block and character budgets for mixed content", () => {
    const document = parseMarkdownDocument(
      "# Result\n\n" +
      Array.from({ length: 12 }, (_, index) => "- item " + index).join("\n") +
      "\n\n| A | B |\n|---|---|\n" +
      Array.from({ length: 8 }, (_, index) => "| row " + index + " | value |").join("\n"),
    );

    const chunks = chunkAgentDocument(document, {
      maxCharacters: 60,
      maxBlocks: 8,
      maxMedia: 2,
      maxTableColumns: 4,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const metrics = agentDocumentMetrics(chunk);
      expect(metrics.characters).toBeLessThanOrEqual(60);
      expect(metrics.blocks).toBeLessThanOrEqual(8);
      expect(metrics.media).toBeLessThanOrEqual(2);
    }
  });
});

describe("oversized native captions", () => {
  test("moves caption and credit overflow out of a media block without exceeding the budget", () => {
    const source: AgentDocument = {
      blocks: [{
        type: "photo",
        media: { kind: "file_id", fileId: "AgAC123" },
        caption: {
          text: "caption text that must be split safely",
          credit: "a very long source credit",
        },
      }],
    };

    const chunks = chunkAgentDocument(source, { maxCharacters: 12, maxBlocks: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.blocks[0]?.type).toBe("photo");
    for (const chunk of chunks) {
      expect(agentDocumentMetrics(chunk).characters).toBeLessThanOrEqual(12);
    }
  });

  test("does not duplicate an oversized collage caption across split wrappers", () => {
    const source: AgentDocument = {
      blocks: [{
        type: "collage",
        blocks: [
          { type: "photo", media: { kind: "file_id", fileId: "A" } },
          { type: "photo", media: { kind: "file_id", fileId: "B" } },
        ],
        caption: { text: "this caption is deliberately much longer than the budget" },
      }],
    };

    const chunks = chunkAgentDocument(source, {
      maxCharacters: 16,
      maxBlocks: 4,
      maxMedia: 1,
    });
    for (const chunk of chunks) {
      const metrics = agentDocumentMetrics(chunk);
      expect(metrics.characters).toBeLessThanOrEqual(16);
      expect(metrics.media).toBeLessThanOrEqual(1);
    }
    const captionedWrappers = chunks
      .flatMap((chunk) => chunk.blocks)
      .filter((block) =>
        (block.type === "collage" || block.type === "slideshow") &&
        block.caption !== undefined
      );
    expect(captionedWrappers).toHaveLength(0);
  });
});

describe("details degradation", () => {
  test("degrades an oversized details summary instead of emitting an invalid rich block", () => {
    const source: AgentDocument = {
      blocks: [{
        type: "details",
        summary: "summary that is too long",
        blocks: [{ type: "paragraph", text: "inside" }],
      }],
    };

    const chunks = chunkAgentDocument(source, { maxCharacters: 8, maxBlocks: 10 });
    for (const chunk of chunks) {
      expect(agentDocumentMetrics(chunk).characters).toBeLessThanOrEqual(8);
    }
    expect(chunks.flatMap((chunk) => chunk.blocks).some((block) => block.type === "details")).toBe(false);
  });
});

describe("Telegram Rich Markdown extensions", () => {
  test("maps Telegram inline decoration syntax and inline HTML to RichText", () => {
    const document = parseMarkdownDocument(
      "==mark== ||secret|| <u>under</u> <sub>2</sub> <sup>3</sup>",
    );
    const rendered = renderTelegramRichDocument(document, { draft: false });
    const json = JSON.stringify(rendered);
    expect(json).toContain('"type":"marked"');
    expect(json).toContain('"type":"spoiler"');
    expect(json).toContain('"type":"underline"');
    expect(json).toContain('"type":"subscript"');
    expect(json).toContain('"type":"superscript"');
  });

  test("maps inline and block LaTeX to native mathematical expressions", () => {
    const document = parseMarkdownDocument(
      "Inline $x^2$ math.\n\n$$\nE=mc^2\n$$",
    );
    const rendered = renderTelegramRichDocument(document, { draft: false });
    const json = JSON.stringify(rendered);
    expect(json).toContain('"type":"mathematical_expression"');
    expect(json).toContain('"expression":"x^2"');
    expect(json).toContain('"expression":"E=mc^2"');
  });

  test("maps Telegram emoji/time image syntax to native RichText", () => {
    const document = parseMarkdownDocument(
      "![🔥](tg://emoji?id=5368324170671202286) ![soon](tg://time?unix=1700000000&format=r)",
    );
    const rendered = renderTelegramRichDocument(document, { draft: false });
    const json = JSON.stringify(rendered);
    expect(json).toContain('"type":"custom_emoji"');
    expect(json).toContain('"custom_emoji_id":"5368324170671202286"');
    expect(json).toContain('"type":"date_time"');
    expect(json).toContain('"unix_time":1700000000');
  });

  test("maps GFM footnotes to Telegram reference links and references", () => {
    const document = parseMarkdownDocument(
      "Result[^source]\n\n[^source]: verified source",
    );
    const rendered = renderTelegramRichDocument(document, { draft: false });
    const json = JSON.stringify(rendered);
    expect(json).toContain('"type":"reference_link"');
    expect(json).toContain('"reference_name":"source"');
    expect(json).toContain('"type":"reference"');
    expect(json).toContain('"name":"source"');
  });

  test("turns Markdown media into native media blocks with captions", () => {
    const document = parseMarkdownDocument(
      '![Preview](https://example.com/screenshot.png "Build output")',
    );
    expect(document.blocks[0]).toMatchObject({
      type: "photo",
      media: { kind: "url", url: "https://example.com/screenshot.png" },
      caption: { text: "Build output" },
    });
    const rendered = renderTelegramRichDocument(document, { draft: false });
    expect(rendered.blocks?.[0]?.type).toBe("photo");
  });

  test("maps details, pullquote, expandable quote, map and collage blocks", () => {
    const document = parseMarkdownDocument(
      "<details open><summary>More **info**</summary>\n\nInside\n\n</details>\n\n" +
      "<aside>Important<cite>Core</cite></aside>\n\n" +
      "<blockquote expandable>Hidden *details*</blockquote>\n\n" +
      '<tg-map lat="52.0907" long="5.1214" zoom="10"></tg-map>\n\n' +
      "<tg-collage>\n\n![](https://example.com/a.png)\n\n![](https://example.com/b.mp4)\n\n</tg-collage>",
    );
    const types = document.blocks.map((block) => block.type);
    expect(types).toContain("details");
    expect(types).toContain("pullquote");
    expect(types).toContain("quote");
    expect(types).toContain("map");
    expect(types).toContain("collage");
    const rendered = renderTelegramRichDocument(document, { draft: false });
    const renderedTypes = rendered.blocks?.map((block) => block.type) ?? [];
    expect(renderedTypes).toContain("details");
    expect(renderedTypes).toContain("pullquote");
    expect(renderedTypes).toContain("expandable_blockquote");
    expect(renderedTypes).toContain("map");
    expect(renderedTypes).toContain("collage");
  });

  test("keeps interactive rich buttons model-safe by default and allows trusted parsing", () => {
    const markdown =
      '<tg-button-row align="center"><tg-button type="callback_data" data="retry" style="primary">Retry</tg-button></tg-button-row>';
    const untrusted = parseMarkdownDocument(markdown);
    expect(untrusted.blocks.some((block) => block.type === "buttons")).toBe(false);
    expect(untrusted.blocks.map((block) => blockPlainTextForTest(block)).join(" ")).toContain("Retry");

    const trusted = parseMarkdownDocument(markdown, { allowInteractiveButtons: true });
    const buttons = trusted.blocks.find((block) => block.type === "buttons");
    expect(buttons?.type).toBe("buttons");
    if (buttons?.type !== "buttons") throw new Error("expected buttons");
    expect(buttons.buttons[0]).toMatchObject({
      callback_data: "retry",
      style: "primary",
    });
    expect(renderTelegramRichDocument(trusted, { draft: false }).blocks?.[0]?.type).toBe("buttons");
  });

  test("never turns model-authored tg://user links into active mentions", () => {
    const raw = "[user](tg://user?id=42)";
    const rendered = renderTelegramRichDocument(parseMarkdownDocument(raw), { draft: false });
    expect(JSON.stringify(rendered)).not.toContain("tg://user");
    expect(JSON.stringify(rendered)).toContain("user");
  });
});

function blockPlainTextForTest(block: AgentDocument["blocks"][number]): string {
  if ("text" in block) return inlinePlainText(block.text);
  if (block.type === "buttons") {
    return block.buttons.map((button) => JSON.stringify(button.text)).join(" ");
  }
  return "";
}

describe("complete RichText IR compilation", () => {
  test("compiles Telegram-only inline entities and button rows", () => {
    const document: AgentDocument = {
      blocks: [{
        type: "paragraph",
        text: [
          { type: "bank_card", text: "card", bankCard: "4242424242424242" },
          " ",
          { type: "hashtag", text: "#core", hashtag: "core" },
          " ",
          { type: "cashtag", text: "$CODE", cashtag: "CODE" },
          " ",
          { type: "bot_command", text: "/start", botCommand: "start" },
          " ",
          { type: "anchor", name: "top" },
          { type: "anchor_link", text: "back", anchorName: "top" },
        ],
      }, {
        type: "buttons",
        align: "right",
        buttons: [{
          text: "Docs",
          url: "https://core.telegram.org/bots/api",
        }],
      }],
    };
    const rendered = renderTelegramRichDocument(document, { draft: false });
    const json = JSON.stringify(rendered);
    expect(json).toContain('"type":"bank_card_number"');
    expect(json).toContain('"type":"hashtag"');
    expect(json).toContain('"type":"cashtag"');
    expect(json).toContain('"type":"bot_command"');
    expect(json).toContain('"type":"anchor"');
    expect(json).toContain('"type":"anchor_link"');
    expect(rendered.blocks?.[1]?.type).toBe("buttons");
  });
});

describe("official Telegram Rich HTML coverage", () => {
  test("parses heading, paragraph, pre/code language, footer and divider blocks", () => {
    const document = parseMarkdownDocument(
      '<h1>Head <u>under</u></h1>\n\n' +
      '<p>Paragraph <mark>marked</mark></p>\n\n' +
      '<pre><code class="language-python">print(&quot;x&quot;)</code></pre>\n\n' +
      '<footer>Footer</footer>\n\n<hr/>',
    );
    expect(document.blocks.map((block) => block.type)).toEqual([
      "heading", "paragraph", "code", "footer", "divider",
    ]);
    expect(document.blocks[2]).toMatchObject({
      type: "code",
      text: 'print("x")',
      language: "python",
    });
  });

  test("parses HTML ordered lists, explicit item values and checkboxes", () => {
    const document = parseMarkdownDocument(
      '<ol start="3" type="a" reversed><li>one</li><li value="7" type="i">two</li></ol>\n\n' +
      '<ul><li><input type="checkbox" checked>done</li><li><input type="checkbox">todo</li></ul>',
    );
    const ordered = document.blocks[0];
    const tasks = document.blocks[1];
    expect(ordered?.type).toBe("list");
    expect(tasks?.type).toBe("list");
    if (ordered?.type !== "list" || tasks?.type !== "list") throw new Error("expected lists");
    expect(ordered.items[0]).toMatchObject({ marker: "a", value: 3 });
    expect(ordered.items[1]).toMatchObject({ marker: "i", value: 7 });
    expect(tasks.items[0]).toMatchObject({ hasCheckbox: true, isChecked: true });
    expect(tasks.items[1]).toMatchObject({ hasCheckbox: true, isChecked: false });
  });

  test("parses HTML table styling, caption, spans and alignment", () => {
    const document = parseMarkdownDocument(
      '<table bordered striped compact><caption>Table caption</caption>' +
      '<tr><th>H</th><td colspan="2" rowspan="2" align="right">V</td></tr>' +
      '<tr><td valign="middle">M</td></tr></table>',
    );
    const table = document.blocks[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("expected table");
    expect(table).toMatchObject({
      isBordered: true,
      isStriped: true,
      isCompact: true,
      caption: { text: "Table caption" },
    });
    expect(table.cells[0]?.[1]).toMatchObject({ colspan: 2, rowspan: 2, align: "right" });
    expect(table.cells[1]?.[0]).toMatchObject({ valign: "middle" });
  });

  test("parses figure caption/credit and media spoiler", () => {
    const document = parseMarkdownDocument(
      '<figure><img src="https://example.com/a.png" tg-spoiler/>' +
      '<figcaption>Photo <b>caption</b><cite>Credit</cite></figcaption></figure>',
    );
    const photo = document.blocks[0];
    expect(photo?.type).toBe("photo");
    if (photo?.type !== "photo") throw new Error("expected photo");
    expect(photo.spoiler).toBe(true);
    expect(photo.caption?.credit).toBe("Credit");
    expect(inlinePlainText(photo.caption?.text ?? "")).toBe("Photo caption");
  });

  test("resolves tg media aliases only through a trusted media map", () => {
    const markdown = '![Build](tg://photo?id=result_1 "Result")';
    const unresolved = parseMarkdownDocument(markdown);
    expect(unresolved.blocks[0]?.type).toBe("paragraph");

    const resolved = parseMarkdownDocument(markdown, {
      richMedia: {
        result_1: { kind: "file_id", fileId: "AgAC_result" },
      },
    });
    expect(resolved.blocks[0]).toMatchObject({
      type: "photo",
      media: { kind: "file_id", fileId: "AgAC_result" },
      caption: { text: "Result" },
    });
  });

  test("supports trusted tg user links without weakening generic URL sanitization", () => {
    const markdown = "[user](tg://user?id=777000)";
    const unsafeByDefault = renderTelegramRichDocument(parseMarkdownDocument(markdown), { draft: false });
    expect(JSON.stringify(unsafeByDefault)).not.toContain("tg://user");

    const trusted = renderTelegramRichDocument(
      parseMarkdownDocument(markdown, { allowTelegramUserLinks: true }),
      { draft: false },
    );
    expect(JSON.stringify(trusted)).toContain("tg://user?id=777000");

    const programmaticUnsafe: AgentDocument = {
      blocks: [{ type: "paragraph", text: { type: "url", text: "x", url: "tg://user?id=777000" } }],
    };
    expect(JSON.stringify(renderTelegramRichDocument(programmaticUnsafe, { draft: false }))).not.toContain("tg://user");
  });

  test("supports every Bot API 10.3 rich button variant only in trusted mode", () => {
    const markdown =
      '<tg-button-row align="right">' +
      '<tg-button type="url" url="tg://user?id=777000" style="success">User</tg-button>' +
      '<tg-button type="callback_data" data="retry" style="link">Retry</tg-button>' +
      '<tg-button type="web_app" url="https://telegram.org">App</tg-button>' +
      '<tg-button type="login_url" url="https://t.me" forward-text="Fwd" request-write-access>Login</tg-button>' +
      '<tg-button type="switch_inline_query" query="q">Inline</tg-button>' +
      '<tg-button type="switch_inline_query_current_chat" query="q2">Here</tg-button>' +
      '<tg-button type="switch_inline_query_chosen_chat" query="q3" allow-user-chats allow-group-chats>Choose</tg-button>' +
      '<tg-button type="copy_text" text="copy me">Copy</tg-button>' +
      '</tg-button-row>';

    expect(parseMarkdownDocument(markdown).blocks.some((block) => block.type === "buttons")).toBe(false);
    const trusted = parseMarkdownDocument(markdown, { allowInteractiveButtons: true });
    const row = trusted.blocks.find((block) => block.type === "buttons");
    expect(row?.type).toBe("buttons");
    if (row?.type !== "buttons") throw new Error("expected buttons");
    expect(row.buttons).toHaveLength(8);
    expect(row.buttons[0]).toMatchObject({ url: "tg://user?id=777000", style: "success" });
    expect(row.buttons[1]).toMatchObject({ callback_data: "retry", style: "link" });
    expect(row.buttons[2]).toHaveProperty("web_app");
    expect(row.buttons[3]).toHaveProperty("login_url");
    expect(row.buttons[4]).toHaveProperty("switch_inline_query");
    expect(row.buttons[5]).toHaveProperty("switch_inline_query_current_chat");
    expect(row.buttons[6]).toHaveProperty("switch_inline_query_chosen_chat");
    expect(row.buttons[7]).toHaveProperty("copy_text");
  });

  test("distinguishes explicit Telegram references from anchors", () => {
    const document = parseMarkdownDocument(
      '<p><a href="#note">ref</a> <a href="#chapter">jump</a></p>\n' +
      '<tg-reference name="note">source</tg-reference>\n' +
      '<a name="chapter"></a>',
    );
    const json = JSON.stringify(renderTelegramRichDocument(document, { draft: false }));
    expect(json).toContain('"type":"reference_link"');
    expect(json).toContain('"reference_name":"note"');
    expect(json).toContain('"type":"anchor_link"');
    expect(json).toContain('"anchor_name":"chapter"');
    expect(json).toContain('"type":"reference"');
  });
});

describe("Telegram Rich Block structural normalization", () => {
  test("normalizes map dimensions to the Bot API geometry limits", () => {
    const normalized = normalizeAgentDocument({
      blocks: [{
        type: "map",
        latitude: 41.9,
        longitude: 12.5,
        zoom: 99,
        width: 9000,
        height: 1000,
      }],
    });
    const map = normalized.blocks[0];
    expect(map?.type).toBe("map");
    if (map?.type !== "map") throw new Error("expected map");
    expect(map.zoom).toBe(24);
    expect((map.width ?? 0) + (map.height ?? 0)).toBeLessThanOrEqual(10000);
    expect((map.width ?? 1) / (map.height ?? 1)).toBeLessThanOrEqual(20);
    expect((map.height ?? 1) / (map.width ?? 1)).toBeLessThanOrEqual(20);
  });

  test("clamps table colspans to the configured column budget", () => {
    const normalized = normalizeAgentDocument({
      blocks: [{
        type: "table",
        cells: [[
          { text: "A", colspan: 99 },
          { text: "B", colspan: 99 },
        ]],
      }],
    }, { maxTableColumns: 4 });
    const table = normalized.blocks[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("expected table");
    expect(table.cells[0]?.[0]?.colspan).toBe(4);
    expect(table.cells[0]?.[1]?.colspan).toBe(3);
  });
});

describe("Telegram renderer limit admission", () => {
  const document: AgentDocument = { blocks: [{ type: "paragraph", text: "safe" }] };
  const ceilings = {
    maxCharacters: 32768,
    maxBlocks: 500,
    maxNesting: 16,
    maxMedia: 50,
    maxTableColumns: 20,
  } as const;

  test("rejects non-finite, fractional and non-positive budgets before normalization", () => {
    for (const key of Object.keys(ceilings)) {
      for (const value of [NaN, Infinity, -Infinity, 0, -1, 1.5]) {
        expect(() => chunkAgentDocument(document, { [key]: value })).toThrow(RangeError);
      }
    }
  });

  test("rejects caller budgets exceeding Telegram hard limits", () => {
    for (const [key, ceiling] of Object.entries(ceilings)) {
      expect(() => chunkAgentDocument(document, { [key]: ceiling + 1 })).toThrow(RangeError);
    }
  });
});
