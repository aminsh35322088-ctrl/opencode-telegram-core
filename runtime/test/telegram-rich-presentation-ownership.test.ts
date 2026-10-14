import { describe, expect, test } from "bun:test";
import {
  parseMarkdownDocument,
  renderTelegramRichDocument,
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
});
