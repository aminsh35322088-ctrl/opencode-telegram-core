import { describe, expect, test } from "bun:test";
import {
  parseMarkdownDocument,
  renderTelegramRichDocument,
  TELEGRAM_RICH_PRESENTATION_CAPABILITIES,
} from "../src/index.js";

describe("Telegram rich presentation ownership", () => {
  test("markdown tables are compact by default without changing table semantics", () => {
    const document = parseMarkdownDocument(
      "| Name | State |\n|:-----|------:|\n| core | ready |",
    );

    const table = document.blocks[0];
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("expected table");

    expect(table).toMatchObject({
      type: "table",
      isBordered: true,
      isCompact: true,
    });
    expect(table.cells[0]?.[0]).toMatchObject({
      text: "Name",
      isHeader: true,
      align: "left",
    });
    expect(table.cells[0]?.[1]).toMatchObject({
      text: "State",
      isHeader: true,
      align: "right",
    });

    const rich = renderTelegramRichDocument(document, { draft: false });
    expect(rich.blocks?.[0]).toMatchObject({
      type: "table",
      is_bordered: true,
      is_compact: true,
    });
  });

  test("explicit HTML table compactness remains attribute-driven", () => {
    const plain = parseMarkdownDocument(
      "<table><tr><th>A</th></tr><tr><td>B</td></tr></table>",
    ).blocks[0];
    expect(plain?.type).toBe("table");
    if (plain?.type !== "table") throw new Error("expected HTML table");
    expect(plain.isCompact).toBeUndefined();

    const compact = parseMarkdownDocument(
      "<table compact><tr><th>A</th></tr><tr><td>B</td></tr></table>",
    ).blocks[0];
    expect(compact?.type).toBe("table");
    if (compact?.type !== "table") throw new Error("expected compact HTML table");
    expect(compact.isCompact).toBe(true);
  });

  test("public capability contract matches the tested Telegram rich surface", () => {
    expect(TELEGRAM_RICH_PRESENTATION_CAPABILITIES).toEqual({
      richMessages: true,
      details: true,
      expandableQuotes: true,
      math: true,
      dateTime: true,
      anchors: true,
      references: true,
      compactTables: true,
      richButtons: true,
      rtlBidi: true,
    });

    const rich = renderTelegramRichDocument(
      parseMarkdownDocument(
        "<details><summary>More</summary>Body</details>\n\n<blockquote expandable>Long quote</blockquote>\n\n<tg-math>x^2</tg-math>\n\n<tg-time unix=1760457600 format=r>now</tg-time>\n\n<a name=proof></a>",
      ),
      { draft: false },
    );
    const serialized = JSON.stringify(rich);
    expect(serialized).toContain('"type":"details"');
    expect(serialized).toContain('"type":"expandable_blockquote"');
    expect(serialized).toContain('"type":"mathematical_expression"');
    expect(serialized).toContain('"type":"date_time"');
    expect(serialized).toContain('"type":"anchor"');

    const references = renderTelegramRichDocument(
      parseMarkdownDocument("See note[^proof].\n\n[^proof]: Evidence"),
      { draft: false },
    );
    const referenceSerialized = JSON.stringify(references);
    expect(referenceSerialized).toContain('"type":"reference_link"');
    expect(referenceSerialized).toContain('"type":"reference"');
  });
});
