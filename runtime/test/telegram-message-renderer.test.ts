import { describe, expect, test } from "bun:test";
import {
  renderTelegramMessageMarkdown,
  renderTelegramMessageDocument,
  withAgentDocumentDirection,
  renderTelegramRichDocument,
  chunkAgentDocument,
  parseMarkdownDocument,
} from "../src/index.js";

describe("canonical regular Telegram renderer", () => {
  test("preserves nested Markdown and contextual escaping", () => {
    const [part] = renderTelegramMessageMarkdown(
      "**bold *italic*** and `a_b * c < d & e` [link](https://example.com/?a=1&b=2)",
    );
    expect(part!.html).toContain("<b>bold <i>italic</i></b>");
    expect(part!.html).toContain("<code>a_b * c &lt; d &amp; e</code>");
    expect(part!.markdownV2).toContain("`a_b * c < d & e`");
    expect(part!.html).toContain('href="https://example.com/?a=1&amp;b=2"');
  });
  test("quotes flatten nested source and keep expandable quotes separate", () => {
    const [part] = renderTelegramMessageDocument({
      blocks: [
        {
          type: "quote",
          text: "one",
          blocks: [{ type: "quote", text: "nested" }],
        },
        { type: "quote", text: "two", expandable: true },
      ],
    });
    expect(part!.html).toBe(
      "<blockquote>nested</blockquote>\n\n<blockquote expandable>two</blockquote>",
    );
    expect(part!.markdownV2).toContain("**>two||");
  });
  test("splits semantic formatting without splitting graphemes or losing ZWNJ", () => {
    const source = "**" + "می‌رود 👨‍💻 🧑🏽‍💻 é ".repeat(600).trimEnd() + "**";
    const parts = renderTelegramMessageMarkdown(source);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((p) => p.text).join("")).toBe(source.slice(2, -2));
    for (const part of parts) {
      expect(part.text.length).toBeLessThanOrEqual(4096);
      expect(part.html.startsWith("<b>")).toBe(true);
      expect(part.html.endsWith("</b>")).toBe(true);
      expect(part.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    }
  });
  test("never treats incomplete source as Telegram syntax", () => {
    for (const source of [
      "*",
      "**",
      "**hello",
      "**hello *",
      "`unfinished",
      "[link](https://example.com",
      "||secret",
    ]) {
      expect(() => renderTelegramMessageMarkdown(source)).not.toThrow();
    }
  });
});

const persianCorpus = [
  "سلام، امروز چطور می‌توانم کمکت کنم؟",
  "نسخه‌ی جدید OpenCode آماده است.",
  "تابع handleRequest() را بررسی کن.",
  "مقدار `foo_bar` را تغییر بده.",
  'این کد را اجرا کن:\n\n```typescript\nconst message = "سلام دنیا";\nconsole.log(message);\n```',
  "مستندات در https://example.com/docs?id=123 قرار دارد.",
  "ایمیل پشتیبانی support@example.com است.",
  "نسخه‌ی v1.18.33 منتشر شد.",
  "۱۲۳ کاربر و 456 request ثبت شده است.",
  "OpenCode (نسخه‌ی جدید) آماده است.",
  "نسخه‌ی جدید (OpenCode v2) آماده است.",
  "نتیجه: موفق! ادامه بده؟",
  "می‌رود، می‌شود، می‌تواند، رفته‌اند، برنامه‌نویسی و خانه‌ها",
  "🔥 نسخه‌ی جدید OpenCode آماده است ✅ 👨‍💻 👩‍🚀 🇮🇷 🧑🏽‍💻 ❤️",
  "> این یک نقل‌قول فارسی با OpenCode است.",
  "- نصب Node.js\n- اجرای `npm install`\n- تست برنامه",
];

describe("Persian/Unicode streaming regression corpus", () => {
  for (const [index, source] of persianCorpus.entries())
    test(`fixture ${index + 1} HTML, MarkdownV2, entities and every partial prefix`, () => {
      const complete = renderTelegramMessageMarkdown(source);
      for (const part of complete) {
        expect(part.text).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u);
        expect(part.html.length).toBeGreaterThan(0);
        expect(part.markdownV2.length).toBeGreaterThan(0);
        for (const entity of part.entities) {
          expect(entity.offset).toBeGreaterThanOrEqual(0);
          expect(entity.length).toBeGreaterThan(0);
          expect(entity.offset + entity.length).toBeLessThanOrEqual(
            part.text.length,
          );
        }
      }
      for (const prefix of new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      }).segment(source)) {
        expect(() =>
          renderTelegramMessageMarkdown(
            source.slice(0, prefix.index + prefix.segment.length),
          ),
        ).not.toThrow();
      }
    });
  test("long mixed response preserves Unicode, code, URLs and default digits", () => {
    const source = (persianCorpus.join("\n\n") + "\n\n").repeat(24);
    const parts = renderTelegramMessageMarkdown(source);
    expect(parts.length).toBeGreaterThan(2);
    const visible = parts.map((p) => p.text).join("");
    for (const word of [
      "می‌رود",
      "می‌شود",
      "می‌تواند",
      "رفته‌اند",
      "خانه‌ها",
      "برنامه‌نویسی",
      "foo_bar",
      "support@example.com",
      "v1.18.33",
      "۱۲۳",
      "456",
      "🧑🏽‍💻",
    ])
      expect(visible).toContain(word);
    for (const part of parts)
      expect(part.text.length).toBeLessThanOrEqual(4096);
  });
  test("untrusted prose overrides are removed without normalizing code or ZWNJ", () => {
    const [part] = renderTelegramMessageMarkdown(
      "می‌رود \u202Etxt.exe\u202C `\u202Eauthored-code\u202C`",
    );
    expect(part!.text).toBe("می‌رود txt.exe \u202Eauthored-code\u202C");
    expect(part!.entities.find((e) => e.type === "code")).toBeDefined();
  });
});

describe("regular-message Telegram semantics", () => {
  test("standard double underscores stay bold; explicit underline supports italic nesting", () => {
    expect(renderTelegramMessageMarkdown("__standard bold__")[0]!.html).toBe(
      "<b>standard bold</b>",
    );
    const [part] = renderTelegramMessageDocument({
      blocks: [
        {
          type: "paragraph",
          text: { type: "underline", text: { type: "italic", text: "x" } },
        },
      ],
    });
    expect(part!.html).toBe("<u><i>x</i></u>");
    expect(part!.markdownV2).toBe("__**_x_**__");
  });
  test("all reserved plain punctuation and literal backslashes are escaped once", () => {
    const text = "_*[]()~`>#+-=|{}.!\\";
    const [part] = renderTelegramMessageDocument({
      blocks: [{ type: "paragraph", text }],
    });
    expect(part!.text).toBe(text);
    expect(part!.markdownV2).toBe([...text].map((c) => "\\" + c).join(""));
  });
  test("code preserves literal backticks, backslashes and Markdown characters", () => {
    const text = "const x = `a_b` \\ **literal** <tag> &";
    const [part] = renderTelegramMessageDocument({
      blocks: [{ type: "code", text, language: "typescript" }],
    });
    expect(part!.text).toBe(text);
    expect(part!.html).toBe(
      '<pre><code class="language-typescript">const x = `a_b` \\ **literal** &lt;tag&gt; &amp;</code></pre>',
    );
    expect(part!.markdownV2).toContain("\\`a_b\\` \\\\ **literal**");
    expect(part!.entities).toEqual([
      { type: "pre", language: "typescript", offset: 0, length: text.length },
    ]);
  });
  test("links preserve query strings and escape only destination backslashes/parentheses", () => {
    const [part] = renderTelegramMessageDocument({
      blocks: [
        {
          type: "paragraph",
          text: {
            type: "url",
            url: "https://example.com/a)?q=a&other=1\\z",
            text: { type: "bold", text: "label" },
          },
        },
      ],
    });
    expect(part!.markdownV2).toBe(
      "[*label*](https://example.com/a\\)?q=a&other=1\\\\z)",
    );
    expect(part!.html).toContain("?q=a&amp;other=1");
  });
  test("valid user mentions, custom emoji and date entities survive", () => {
    const [part] = renderTelegramMessageMarkdown(
      "[@username](tg://user?id=123) ![🔥](tg://emoji?id=5368324170671202286) ![tomorrow](tg://time?unix=1647531900&format=wDT)",
      { allowTelegramUserLinks: true },
    );
    expect(part!.entities.map((e) => e.type)).toEqual([
      "text_link",
      "custom_emoji",
      "date_time",
    ]);
    expect(part!.html).toContain('href="tg://user?id=123"');
    expect(part!.markdownV2).toContain("tg://emoji?id=5368324170671202286");
    expect(part!.markdownV2).toContain("tg://time?unix=1647531900&format=wDT");
  });
  test("unsupported HTML remains text; model HTML entities decode once", () => {
    const [part] = renderTelegramMessageMarkdown(
      "<script>x</script> &amp; &lt;ok&gt;",
    );
    expect(part!.html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(part!.html).not.toContain("&amp;amp;");
  });
  test("headings, lists, tasks and tables degrade through semantic nodes", () => {
    const parts = renderTelegramMessageMarkdown(
      "# Heading\n\n- one\n  - nested\n- [x] yes\n- [ ] no\n\n3. three\n4. four\n\n---\n\n| key | value |\n| --- | --- |\n| x | y |",
    );
    const [part] = parts;
    expect(part!.html).toContain("<b>Heading</b>");
    for (const visible of [
      "• one",
      "  • nested",
      "☑ yes",
      "☐ no",
      "3. three",
      "4. four",
      "────────",
    ])
      expect(part!.text).toContain(visible);
    expect(part!.html).toContain("<pre>key | value");
  });
  test("long fenced code reopens entities without changing authored code", () => {
    const code = '  const message = "سلام 👨‍💻";\\path\n'.repeat(400).trimEnd();
    const parts = renderTelegramMessageMarkdown(
      "```typescript\n" + code + "\n```",
    );
    expect(parts.map((p) => p.text).join("")).toBe(code);
    for (const part of parts) {
      expect(
        part.html.startsWith('<pre><code class="language-typescript">'),
      ).toBe(true);
      expect(part.html.endsWith("</code></pre>")).toBe(true);
    }
  });
  test("formatting cannot enclose code and nested links cannot produce illegal entities", () => {
    const [part] = renderTelegramMessageDocument({
      blocks: [
        {
          type: "paragraph",
          text: {
            type: "bold",
            text: ["a", { type: "code", text: "code" }, "b"],
          },
        },
      ],
    });
    expect(part!.html).toBe("<b>a</b><code>code</code><b>b</b>");
  });
});

test("adjacent italic/underline delimiters have Telegram's ambiguity separator", () => {
  const [part] = renderTelegramMessageDocument({
    blocks: [
      {
        type: "paragraph",
        text: [
          { type: "italic", text: "a" },
          { type: "underline", text: "b" },
        ],
      },
    ],
  });
  expect(part!.markdownV2).toBe("_a_**__b__");
});
test("invalid numeric HTML entities never crash and decode exactly once", () => {
  const [part] = renderTelegramMessageMarkdown(
    "<u>&#9999999999; &#xD800; &#38;lt;</u>",
  );
  expect(part!.text).toBe("� � &lt;");
  expect(part!.html).toBe("<u>� � &amp;lt;</u>");
});

test("grapheme boundaries survive changes of semantic formatting within an emoji", () => {
  const parts = renderTelegramMessageDocument({
    blocks: [
      {
        type: "paragraph",
        text: ["a".repeat(4090), { type: "bold", text: "👨" }, "‍💻"],
      },
    ],
  });
  expect(parts.map((p) => p.text).join("")).toBe("a".repeat(4090) + "👨‍💻");
  expect(parts.at(-1)!.text.endsWith("👨‍💻")).toBe(true);
  expect(parts[0]!.text.endsWith("👨")).toBe(false);
});

test("native rich direction metadata never injects controls into Persian technical text", () => {
  const source = {
    blocks: [
      {
        type: "paragraph" as const,
        text: "نسخه‌ی OpenCode v1.18.33 روی پورت 8080 می‌رود",
      },
      { type: "code" as const, text: 'const text = "سلام";' },
    ],
  };
  const prepared = withAgentDocumentDirection(source);
  expect(prepared.rtl).toBe(true);
  expect(prepared.blocks).toEqual(source.blocks);
  expect(
    JSON.stringify(renderTelegramRichDocument(prepared, { draft: true })),
  ).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u);
});

test("unsafe bidi control in a link destination never becomes a Telegram link", () => {
  const [part] = renderTelegramMessageDocument({
    blocks: [
      {
        type: "paragraph",
        text: {
          type: "url",
          text: "safe label",
          url: "https://example.com/\u202epayload",
        },
      },
    ],
  });
  expect(part!.entities).toEqual([]);
  expect(part!.html).toBe("safe label");
});

test("independent native table continuations repeat their header within the budget", () => {
  const source =
    "| Name | Score |\n| --- | --- |\n" +
    Array.from({ length: 12 }, (_, i) => `| api${i}.js | ${i} |`).join("\n");
  const chunks = chunkAgentDocument(parseMarkdownDocument(source), {
    maxCharacters: 100,
    maxBlocks: 6,
  });
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks)
    for (const block of chunk.blocks) {
      expect(block.type).toBe("table");
      if (block.type === "table")
        expect(block.cells[0]?.[0]?.text).toBe("Name");
    }
});
