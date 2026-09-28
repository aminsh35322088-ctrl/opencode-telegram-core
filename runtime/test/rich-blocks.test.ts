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

  test("collage and slideshow nest blocks under their own type", () => {
    for (const type of ["collage", "slideshow"] as const) {
      const wrapper = first(
        blockOf(type, {
          blocks: [{ type: "paragraph", text: "a" }],
          caption: { text: "cap" },
        }),
      ) as Record<string, unknown>;
      expect(wrapper.type).toBe(type);
      expect(wrapper.blocks).toEqual([{ type: "paragraph", text: "a" }]);
      expect(wrapper.caption).toBe("cap");
    }
  });

  test("media blocks pass a file_id straight through", () => {
    for (const type of [
      "photo",
      "video",
      "audio",
      "voice",
      "animation",
      "document",
    ] as const) {
      const media = first(
        blockOf(type, { media: { kind: "file_id", fileId: "AgAC123" } }),
      ) as Record<string, unknown>;
      expect(media.type).toBe(type);
      expect(media[type]).toBe("AgAC123");
      expect(media.caption).toBeUndefined();
    }
  });

  test("media blocks accept https and tg references", () => {
    const https = first(
      blockOf("photo", { media: { kind: "url", url: "https://cdn.example.com/a.png" } }),
    ) as Record<string, unknown>;
    expect(https.photo).toBe("https://cdn.example.com/a.png");

    const tg = first(
      blockOf("photo", { media: { kind: "url", url: "tg://photo?id=userphoto" } }),
    ) as Record<string, unknown>;
    expect(tg.photo).toBe("tg://photo?id=userphoto");
  });

  test("media blocks reject a reference the core cannot hand to Telegram", () => {
    expect(() =>
      first(blockOf("photo", { media: { kind: "url", url: "http://insecure.example.com/a.png" } })),
    ).toThrow("https://");
    expect(() =>
      first(blockOf("photo", { media: { kind: "url", url: "file:///etc/passwd" } })),
    ).toThrow("https://");
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
    expect(map).toMatchObject({ zoom: 12, width: 320, height: 200, caption: "Tehran" });
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

  test("thinking gating still applies inside nested containers", () => {
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

    const asDraft = first(
      {
        blocks: [
          { type: "details", summary: "s", blocks: [{ type: "thinking", text: "shown" }] },
        ],
      },
      true,
    ) as { blocks: Array<Record<string, unknown>> };
    expect(asDraft.blocks[0]?.type).toBe("thinking");
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
