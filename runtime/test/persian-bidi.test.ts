import { describe, expect, test } from "bun:test";
import {
  BIDI_ISOLATE,
  GrammyNativeMarkdownStreamPort,
  agentDocumentMetrics,
  chunkAgentDocument,
  detectDocumentDirection,
  detectMarkdownDirection,
  detectTextDirection,
  inlinePlainText,
  optimizeAgentDocumentBidi,
  parseMarkdownDocument,
  renderTelegramRichDocument,
  stripBidiControls,
  type AgentDocument,
  type AgentInline,
} from "../src/index.js";

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function firstParagraphText(document: AgentDocument): AgentInline {
  const block = document.blocks[0];
  if (!block || block.type !== "paragraph") throw new Error("expected paragraph");
  return block.text;
}

describe("Persian and mixed-direction detection", () => {
  test("detects Persian-dominant mixed prose as RTL", () => {
    expect(detectTextDirection("برای نصب Node.js نسخه 1.18.33 را بررسی کن")).toBe("rtl");
    expect(detectDocumentDirection({
      blocks: [{
        type: "paragraph",
        text: "برای نصب Node.js نسخه 1.18.33 را بررسی کن",
      }],
    })).toBe("rtl");
  });

  test("ignores fenced and inline code while detecting Markdown direction", () => {
    const markdown =
      "~~~ts\n" +
      "const extremelyLongEnglishIdentifier = anotherEnglishIdentifier;\n" +
      "~~~\n\n" +
      "این پاسخ برای کاربر فارسی نوشته شده و خوانایی مهم است.\n\n" +
      "دستور \x60npm install\x60 را اجرا کن.";
    expect(detectMarkdownDirection(markdown)).toBe("rtl");
  });

  test("keeps an English-dominant document LTR and isolates its Persian run", () => {
    const source: AgentDocument = {
      blocks: [{
        type: "paragraph",
        text: "Use the secure حالت mode now and keep the response readable.",
      }],
    };
    const optimized = optimizeAgentDocumentBidi(source);
    expect(optimized.rtl).toBeUndefined();
    const rendered = JSON.stringify(renderTelegramRichDocument(optimized, { draft: false }));
    expect(rendered).toContain(BIDI_ISOLATE.RLI);
    expect(rendered).toContain(BIDI_ISOLATE.PDI);
  });
});

describe("Persian mixed LTR isolation", () => {
  test("sets the Telegram document RTL flag and isolates English technical tokens", () => {
    const markdown =
      "برای اجرای \x60npm install\x60 فایل \x60package.json\x60 را در Node.js " +
      "نسخه 1.18.33 و مسیر src/server/index.ts بررسی کن.";
    const optimized = optimizeAgentDocumentBidi(parseMarkdownDocument(markdown));
    expect(optimized.rtl).toBe(true);

    const rendered = renderTelegramRichDocument(optimized, { draft: false });
    const json = JSON.stringify(rendered);
    expect(rendered.is_rtl).toBe(true);
    expect(count(json, BIDI_ISOLATE.LRI)).toBeGreaterThanOrEqual(5);
    expect(count(json, BIDI_ISOLATE.LRI)).toBe(count(json, BIDI_ISOLATE.PDI));
    expect(json).toContain("npm install");
    expect(json).toContain("package.json");
    expect(json).toContain("src/server/index.ts");
  });

  test("handles attached mixed-script words such as APIها without adding spaces", () => {
    const optimized = optimizeAgentDocumentBidi({
      blocks: [{ type: "paragraph", text: "APIها فعال شدند و GitHubرو هم بررسی کن" }],
    });
    expect(optimized.rtl).toBe(true);
    expect(inlinePlainText(firstParagraphText(optimized))).toBe(
      "APIها فعال شدند و GitHubرو هم بررسی کن",
    );

    const json = JSON.stringify(renderTelegramRichDocument(optimized, { draft: false }));
    expect(count(json, BIDI_ISOLATE.LRI)).toBeGreaterThanOrEqual(2);
    expect(json).toContain('"API"');
    expect(json).toContain('"GitHub"');
  });

  test("strips caller/model supplied bidi controls from prose and owns isolation itself", () => {
    const malicious = "سلام \u202Eabc\u202C دنیا";
    expect(stripBidiControls(malicious)).toBe("سلام abc دنیا");

    const optimized = optimizeAgentDocumentBidi({
      blocks: [{ type: "paragraph", text: malicious }],
    });
    const serialized = JSON.stringify(optimized);
    expect(serialized).not.toContain("\u202E");
    expect(serialized).not.toContain("\u202C");

    const rendered = JSON.stringify(renderTelegramRichDocument(optimized, { draft: false }));
    expect(rendered).toContain(BIDI_ISOLATE.LRI);
    expect(rendered).toContain(BIDI_ISOLATE.PDI);
  });

  test("does not modify code block bytes", () => {
    const code = "const title = \"سلام\";\nconsole.log(title);\u202E";
    const source: AgentDocument = {
      blocks: [
        { type: "paragraph", text: "این کد را اجرا کن" },
        { type: "code", text: code, language: "ts" },
      ],
    };
    const optimized = optimizeAgentDocumentBidi(source);
    const codeBlock = optimized.blocks[1];
    expect(codeBlock?.type).toBe("code");
    if (codeBlock?.type !== "code") throw new Error("expected code");
    expect(codeBlock.text).toBe(code);
  });

  test("keeps inline code payload exact while isolating it from Persian prose", () => {
    const command = "npm install --save";
    const source: AgentDocument = {
      blocks: [{
        type: "paragraph",
        text: ["دستور ", { type: "code", text: command }, " را اجرا کن"],
      }],
    };
    const optimized = optimizeAgentDocumentBidi(source);
    expect(inlinePlainText(firstParagraphText(optimized))).toBe(
      "دستور " + command + " را اجرا کن",
    );

    const json = JSON.stringify(renderTelegramRichDocument(optimized, { draft: false }));
    expect(json).toContain(command);
    expect(json).toContain(BIDI_ISOLATE.LRI);
    expect(json).toContain(BIDI_ISOLATE.PDI);
  });
});

describe("RTL-aware structural rendering", () => {
  test("auto-aligns table cells by their own direction while preserving explicit alignment", () => {
    const optimized = optimizeAgentDocumentBidi({
      blocks: [{
        type: "table",
        cells: [[
          { text: "وضعیت" },
          { text: "Node.js" },
          { text: "1.18.33" },
          { text: "وسط", align: "center" },
        ]],
      }],
    }, { direction: "rtl" });

    const table = optimized.blocks[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("expected table");
    expect(table.cells[0]?.[0]?.align).toBe("right");
    expect(table.cells[0]?.[1]?.align).toBe("left");
    expect(table.cells[0]?.[2]?.align).toBe("left");
    expect(table.cells[0]?.[3]?.align).toBe("center");
  });

  test("optimizes nested details, list items, quotes and media captions", () => {
    const optimized = optimizeAgentDocumentBidi({
      blocks: [{
        type: "details",
        summary: "جزئیات Node.js",
        blocks: [{
          type: "list",
          items: [{
            blocks: [{ type: "paragraph", text: "نسخه v1.2.3 آماده است" }],
          }],
        }, {
          type: "quote",
          text: "مسیر src/index.ts درست است",
        }, {
          type: "photo",
          media: { kind: "file_id", fileId: "AgAC_test" },
          caption: { text: "خروجی Build 42" },
        }],
      }],
    });

    expect(optimized.rtl).toBe(true);
    const json = JSON.stringify(renderTelegramRichDocument(optimized, { draft: false }));
    expect(count(json, BIDI_ISOLATE.LRI)).toBeGreaterThanOrEqual(4);
  });
});

describe("BiDi-aware chunking", () => {
  test("counts isolate controls against Telegram character limits", () => {
    const optimized = optimizeAgentDocumentBidi({
      blocks: [{ type: "paragraph", text: "سلام Node.js" }],
    });
    const paragraph = optimized.blocks[0];
    if (paragraph?.type !== "paragraph") throw new Error("expected paragraph");

    const plainLength = Array.from(inlinePlainText(paragraph.text)).length;
    const metrics = agentDocumentMetrics(optimized);
    expect(metrics.characters).toBe(plainLength + 2);
  });

  test("never emits an unbalanced directional isolate when a long LTR token is chunked", () => {
    const optimized = optimizeAgentDocumentBidi({
      blocks: [{ type: "paragraph", text: "سلام VeryLongEnglishIdentifier دنیا" }],
    });
    const chunks = chunkAgentDocument(optimized, {
      maxCharacters: 10,
      maxBlocks: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(agentDocumentMetrics(chunk).characters).toBeLessThanOrEqual(10);
      const json = JSON.stringify(renderTelegramRichDocument(chunk, { draft: false }));
      expect(count(json, BIDI_ISOLATE.LRI)).toBe(count(json, BIDI_ISOLATE.PDI));
      expect(count(json, BIDI_ISOLATE.RLI)).toBeLessThanOrEqual(count(json, BIDI_ISOLATE.PDI));
    }
  });
});

describe("native streaming direction", () => {
  test("adds is_rtl to accumulated Persian Rich Markdown drafts without rewriting Markdown", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = {
      raw: {
        async sendRichMessageDraft(payload: Record<string, unknown>) {
          calls.push(payload);
          return {};
        },
        async sendRichMessage(payload: Record<string, unknown>) {
          calls.push(payload);
          return {};
        },
      },
    };

    const port = new GrammyNativeMarkdownStreamPort(api as never);
    await port.streamMarkdown(
      { chatId: 1 },
      10,
      ["این پاسخ فارسی است و Node.js داخل آن آمده."],
      {
        signal: new AbortController().signal,
        guard: () => true,
      },
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const rich = call.rich_message as Record<string, unknown>;
      expect(rich.is_rtl).toBe(true);
      expect(typeof rich.markdown).toBe("string");
      expect(rich.markdown).toContain("Node.js");
    }
  });

  test("does not force is_rtl for English streaming output", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const api = {
      raw: {
        async sendRichMessageDraft(payload: Record<string, unknown>) {
          calls.push(payload);
          return {};
        },
        async sendRichMessage(payload: Record<string, unknown>) {
          calls.push(payload);
          return {};
        },
      },
    };

    const port = new GrammyNativeMarkdownStreamPort(api as never);
    await port.streamMarkdown(
      { chatId: 1 },
      11,
      ["This is an English response with Node.js."],
      {
        signal: new AbortController().signal,
        guard: () => true,
      },
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const rich = call.rich_message as Record<string, unknown>;
      expect(rich.is_rtl).toBeUndefined();
    }
  });
});
