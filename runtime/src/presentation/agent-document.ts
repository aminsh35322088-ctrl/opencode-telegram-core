export type AgentBlock =
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "heading"; readonly text: string; readonly level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { readonly type: "code"; readonly text: string; readonly language?: string }
  | { readonly type: "quote"; readonly text: string; readonly expandable?: boolean }
  | { readonly type: "math"; readonly expression: string }
  | { readonly type: "divider" }
  | { readonly type: "thinking"; readonly text: string };

export interface AgentDocument {
  readonly blocks: readonly AgentBlock[];
  readonly rtl?: boolean;
}
