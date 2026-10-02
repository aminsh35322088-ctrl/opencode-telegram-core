import type { RichMessageButton } from "grammy/types";
import type { AgentInline } from "./agent-inline.js";

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
  | { readonly type: "quote"; readonly text: AgentInline; readonly blocks?: readonly AgentBlock[]; readonly expandable?: boolean; readonly credit?: AgentInline }
  | { readonly type: "pullquote"; readonly text: AgentInline; readonly credit?: AgentInline }
  | { readonly type: "math"; readonly expression: string }
  | { readonly type: "divider" }
  | { readonly type: "thinking"; readonly text: AgentInline }
  | { readonly type: "footer"; readonly text: AgentInline }
  | { readonly type: "anchor"; readonly name: string }
  | { readonly type: "buttons"; readonly buttons: readonly RichMessageButton[]; readonly align?: "left" | "center" | "right" }
  | { readonly type: "list"; readonly items: readonly AgentListItem[] }
  | { readonly type: "table"; readonly cells: readonly (readonly AgentTableCell[])[]; readonly isBordered?: boolean; readonly isStriped?: boolean; readonly isCompact?: boolean; readonly caption?: AgentCaption }
  | { readonly type: "details"; readonly summary: AgentInline; readonly blocks: readonly AgentBlock[]; readonly isOpen?: boolean }
  | { readonly type: "collage"; readonly blocks: readonly AgentBlock[]; readonly caption?: AgentCaption }
  | { readonly type: "slideshow"; readonly blocks: readonly AgentBlock[]; readonly caption?: AgentCaption }
  | { readonly type: "photo"; readonly media: AgentMediaRef; readonly caption?: AgentCaption; readonly spoiler?: boolean }
  | { readonly type: "video"; readonly media: AgentMediaRef; readonly caption?: AgentCaption; readonly spoiler?: boolean }
  | { readonly type: "audio"; readonly media: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "animation"; readonly media: AgentMediaRef; readonly caption?: AgentCaption; readonly spoiler?: boolean }
  | { readonly type: "document"; readonly media: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "voice_note"; readonly media: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "voice"; readonly media: AgentMediaRef; readonly caption?: AgentCaption }
  | { readonly type: "map"; readonly latitude: number; readonly longitude: number; readonly zoom?: number; readonly width?: number; readonly height?: number; readonly caption?: AgentCaption };

export interface AgentDocument {
  readonly blocks: readonly AgentBlock[];
  readonly rtl?: boolean;
}
