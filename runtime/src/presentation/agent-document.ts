import type { AgentInline } from "./agent-inline.js";

export type AgentBlock =
  | { readonly type: "paragraph"; readonly text: AgentInline }
  | { readonly type: "heading"; readonly text: AgentInline; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly type: "code"; readonly text: AgentInline; readonly language?: string }
  | { readonly type: "quote"; readonly text: AgentInline; readonly expandable?: boolean }
  | { readonly type: "math"; readonly expression: string }
  | { readonly type: "divider" }
  | { readonly type: "thinking"; readonly text: AgentInline };

export interface AgentDocument {
  readonly blocks: readonly AgentBlock[];
  readonly rtl?: boolean;
}
