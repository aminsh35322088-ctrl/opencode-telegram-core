import { describe, expect, test } from "bun:test";
import {
  renderTelegramRichDocument,
  type AgentBlock,
  type AgentDocument,
} from "../src/index.js";

function first(document: AgentDocument, draft = false): Record<string, unknown> {
  const blocks = renderTelegramRichDocument(document, { draft }).blocks ?? [];
  return blocks[0] as unknown as Record<string, unknown>;
}

function blockOf(type: AgentBlock["type"], extra: Record<string, unknown> = {}): AgentDocument {
  return { blocks: [{ type, ...extra } as AgentBlock] };
}

describe("rich block coverage", () => {
  test("footer and anchor blocks carry their payload", () => {
    expect(first(blockOf("footer", { text: "note" }))).toEqual({
      type: "footer",
      text: "note",
    });
    expect(first(blockOf("anchor", { name: "section-1" }))).toEqual({
      type: "anchor",
      name: "section-1",
    });
  });

  test("pull quote carries optional credit", () => {
    expect(first(blockOf("pullquote", { text: "quoted", credit: "Ada" }))).toEqual({
      type: "pullquote",
      text: "quoted",
      credit: "Ada",
    });
    expect(first(blockOf("pullquote", { text: "quoted" }))).toEqual({
      type: "pullquote",
      text: "quoted",
    });
  });

  test("block quotations carry optional credit in both forms", () => {
    expect(first(blockOf("quote", { text: "q", credit: "Ada" }))).toEqual({
      type: "blockquote",
      blocks: [{ type: "paragraph", text: "q" }],
      credit: "Ada",
    });
    expect(first(blockOf("quote", { text: "q", expandable: true, credit: "Ada" }))).toEqual({
      type: "expandable_blockquote",
      text: "q",
      credit: "Ada",
    });
  });

  test("lists carry markers and checkbox state", () => {
    const bullet = first(
      blockOf("list", {
        items: [{ blocks: [{ type: "paragraph", text: "one" }] }],
      }),
    ) as { items: Array<Record<string, unknown>> };
    expect(bullet.items[0]?.blocks).toEqual([{ type: "paragraph", text: "one" }]);
    expect(bullet.items[0]?.type).toBeUndefined();

    const ordered = first(
      blockOf("list", {
        items: [{ marker: "1", blocks: [{ type: "paragraph", text: "one" }] }],
      }),
    ) as { items: Array<Record<string, unknown>> };
    expect(ordered.items[0]?.type).toBe("1");

    const checkbox = first(
      blockOf("list", {
        items: [
          {
            hasCheckbox: true,
            isChecked: true,
            value: 7,
            blocks: [{ type: "paragraph", text: "done" }],
          },
        ],
      }),
    ) as { items: Array<Record<string, unknown>> };
    expect(checkbox.items[0]).toMatchObject({
      has_checkbox: true,
      is_checked: true,
      value: 7,
    });
  });

  test("tables default cell alignment and carry spans and header flags", () => {
    const table = first(
      blockOf("table", {
        cells: [
          [
            { text: "A", isHeader: true },
            { text: "B", colspan: 2 },
          ],
        ],
      }),
    ) as { cells: Array<Array<Record<string, unknown>>> };
    expect(table.cells[0]?.[0]).toEqual({
      align: "left",
      valign: "top",
      text: "A",
      is_header: true,
    });
    expect(table.cells[0]?.[1]).toEqual({
      align: "left",
      valign: "top",
      text: "B",
      colspan: 2,
    });
  });

  test("table styling and caption are only sent when set", () => {
    const plain = first(blockOf("table", { cells: [[{ text: "x" }]] })) as Record<string, unknown>;
    expect(plain.is_bordered).toBeUndefined();
    expect(plain.caption).toBeUndefined();

    const styled = first(
      blockOf("table", {
        cells: [[{ text: "x" }]],
        isBordered: true,
        isStriped: true,
        isCompact: true,
        caption: { text: "Table 1", credit: "source" },
      }),
    ) as Record<string, unknown>;
    expect(styled).toMatchObject({ is_bordered: true, is_striped: true, is_compact: true });
    expect(styled.caption).toBe("Table 1");
  });

  test("details nests blocks and reports open state", () => {
    const details = first(
      blockOf("details", {
        summary: "more",
        isOpen: true,
        blocks: [{ type: "paragraph", text: "hidden" }],
      }),
    ) as Record<string, unknown>;
    expect(details.type).toBe("details");
    expect(details.summary).toBe("more");
    expect(details.is_open).toBe(true);
    expect(details.blocks).toEqual([{ type: "paragraph", text: "hidden" }]);
  });

  test("collage and slideshow keep structured captions", () => {
    for (const type of ["collage", "slideshow"] as const) {
      const wrapper = first(
        blockOf(type, {
          blocks: [{ type: "paragraph", text: "a" }],
          caption: { text: "cap", credit: "source" },
        }),
      ) as Record<string, unknown>;
      expect(wrapper.type).toBe(type);
      expect(wrapper.blocks).toEqual([{ type: "paragraph", text: "a" }]);
      expect(wrapper.caption).toEqual({ text: "cap", credit: "source" });
    }
  });

  test("media blocks compile file_id references into InputMedia objects", () => {
    const cases = [
      ["photo", "photo"],
      ["video", "video"],
      ["audio", "audio"],
      ["animation", "animation"],
      ["document", "document"],
      ["voice_note", "voice_note"],
      ["voice", "voice_note"],
    ] as const;
    for (const [inputType, outputType] of cases) {
      const media = first(
        blockOf(inputType, {
          media: { kind: "file_id", fileId: "AgAC123" },
          caption: { text: "caption", credit: "source" },
        }),
      ) as Record<string, unknown>;
      expect(media.type).toBe(outputType);
      expect(media[outputType]).toEqual({ type: outputType, media: "AgAC123" });
      expect(media.caption).toEqual({ text: "caption", credit: "source" });
    }
  });

  test("media blocks accept secure remote URLs", () => {
    const https = first(
      blockOf("photo", { media: { kind: "url", url: "https://cdn.example.com/a.png" } }),
    ) as Record<string, unknown>;
    expect(https.photo).toEqual({
      type: "photo",
      media: "https://cdn.example.com/a.png",
    });
  });

  test("media blocks reject insecure and tg pseudo-URLs in direct InputMedia fields", () => {
    for (const url of [
      "http://insecure.example.com/a.png",
      "file:///etc/passwd",
      "tg://photo?id=userphoto",
    ]) {
      expect(() => first(blockOf("photo", { media: { kind: "url", url } }))).toThrow("https://");
    }
  });

  test("map carries a location plus explicit sizing", () => {
    const map = first(
      blockOf("map", {
        latitude: 35.68,
        longitude: 51.38,
        zoom: 12,
        width: 320,
        height: 200,
        caption: { text: "Tehran" },
      }),
    ) as Record<string, unknown>;
    expect(map.location).toEqual({ latitude: 35.68, longitude: 51.38 });
    expect(map).toMatchObject({
      zoom: 12,
      width: 320,
      height: 200,
      caption: { text: "Tehran" },
    });
  });

  test("nested blocks are compiled recursively, not dropped", () => {
    const nested = first(
      blockOf("details", {
        summary: "outer",
        blocks: [
          {
            type: "list",
            items: [
              {
                blocks: [{ type: "code", text: "npm test", language: "bash" }],
              },
            ],
          },
        ],
      }),
    ) as { blocks: Array<Record<string, unknown>> };
    const list = nested.blocks[0] as { type?: string; items: Array<{ blocks: Array<Record<string, unknown>> }> };
    expect(list.type).toBe("list");
    expect(list.items[0]?.blocks[0]).toMatchObject({ type: "pre", language: "bash" });
  });

  test("thinking gating applies inside details and list items", () => {
    const details = first(
      {
        blocks: [
          {
            type: "details",
            summary: "s",
            blocks: [{ type: "thinking", text: "hidden" }],
          },
        ],
      },
      false,
    ) as { blocks: unknown[] };
    expect(details.blocks).toEqual([]);

    const finalList = first(
      {
        blocks: [{
          type: "list",
          items: [{ blocks: [{ type: "thinking", text: "hidden-list" }] }],
        }],
      },
      false,
    ) as { items: Array<{ blocks: unknown[] }> };
    expect(finalList.items[0]?.blocks).toEqual([]);

    const draftList = first(
      {
        blocks: [{
          type: "list",
          items: [{ blocks: [{ type: "thinking", text: "shown" }] }],
        }],
      },
      true,
    ) as { items: Array<{ blocks: Array<Record<string, unknown>> }> };
    expect(draftList.items[0]?.blocks[0]?.type).toBe("thinking");
  });

  test("the seven original block types are byte-identical to before", () => {
    const document: AgentDocument = {
      blocks: [
        { type: "paragraph", text: "p" },
        { type: "heading", text: "h", level: 2 },
        { type: "code", text: "c", language: "ts" },
        { type: "quote", text: "q" },
        { type: "math", expression: "x" },
        { type: "divider" },
      ],
    };
    const blocks = renderTelegramRichDocument(document, { draft: false }).blocks ?? [];
    expect(blocks).toEqual([
      { type: "paragraph", text: "p" },
      { type: "heading", text: "h", size: 2 },
      { type: "pre", text: "c", language: "ts" },
      { type: "blockquote", blocks: [{ type: "paragraph", text: "q" }] },
      { type: "mathematical_expression", expression: "x" },
      { type: "divider" },
    ]);
  });
});
