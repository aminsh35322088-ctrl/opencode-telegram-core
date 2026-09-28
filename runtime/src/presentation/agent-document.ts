import type { AgentInline } from "./agent-inline.js";

/**
 * A file the agent produced, referenced rather than uploaded. The core never
 * transfers bytes: Telegram fetches the content itself from an existing
 * `file_id`, an `https://` URL, or a `tg://` reference.
 */
export type AgentMediaRef =
  | { readonly kind: "file_id"; readonly fileId: string }
  | { readonly kind: "url"; readonly url: string };

export interface AgentCaption {
  readonly text: AgentInline;
  readonly credit?: AgentInline;
}

export interface AgentTableCell {
  readonly text?: AgentInline;
  readonly isHeader?: boolean;
  readonly colspan?: number;
  readonly rowspan?: number;
  readonly align?: "left" | "center" | "right";
  readonly valign?: "top" | "middle" | "bottom";
}

export type AgentListItem = {
  /** `undefined` renders a bullet; `"a" | "A" | "i" | "I" | "1"` an ordered list. */
  readonly marker?: "a" | "A" | "i" | "I" | "1";
  readonly blocks: readonly AgentBlock[];
  readonly hasCheckbox?: boolean;
  readonly isChecked?: boolean;
  readonly value?: number;
};

export type AgentBlock =
  | { readonly type: "paragraph"; readonly text: AgentInline }
  | { readonly type: "heading"; readonly text: AgentInline; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly type: "code"; readonly text: AgentInline; readonly language?: string }
  | { readonly type: "quote"; readonly text: AgentInline; readonly expandable?: boolean }
  | { readonly type: "pullquote"; readonly text: AgentInline; readonly credit?: AgentInline }
  | { readonly type: "math"; readonly expression: string }
  | { readonly type: "divider" }
  | { readonly type: "thinking"; readonly text: AgentInline }
  | { readonly type: "footer"; readonly text: AgentInline }
  | { readonly type: "anchor"; readonly name: string }
  | { readonly type: "list"; readonly items: readonly AgentListItem[] }
  | {
      readonly type: "table";
      readonly cells: readonly (readonly AgentTableCell[])[];
      readonly isBordered?: boolean;
      readonly isStriped?: boolean;
      readonly isCompact?: boolean;
      readonly caption?: AgentCaption;
    }
  | {
      readonly type: "details";
      readonly summary: AgentInline;
      readonly blocks: readonly AgentBlock[];
      readonly isOpen?: boolean;
    }
  | { readonly type: "collage"; readonly blocks: readonly AgentBlock[]; readonly caption?: AgentCaption }
  | { readonly type: "slideshow"; readonly blocks: readonly AgentBlock[]; readonly caption?: AgentCaption }
  | { readonly type: "photo"; readonly photo: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "video"; readonly video: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "audio"; readonly audio: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "voice"; readonly voice: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "animation"; readonly animation: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "document"; readonly document: AgentMediaRef; readonly caption?: AgentCaption }
  | {
      readonly type: "map";
      readonly latitude: number;
      readonly longitude: number;
      readonly zoom: number;
      readonly width: number;
      readonly height: number;
      readonly caption?: AgentCaption;
    };

export interface AgentDocument {
  readonly blocks: readonly AgentBlock[];
  readonly rtl?: boolean;
}
