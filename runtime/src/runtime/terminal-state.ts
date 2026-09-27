export type TerminalReason =
  | "COMPLETED"
  | "COMPLETED_EMPTY"
  | "ABORTED_USER"
  | "ABORTED_STALL"
  | "ABORTED_TIMEOUT"
  | "PROVIDER_ERROR"
  | "TELEGRAM_ERROR"
  | "TOOL_ERROR"
  | "WORKER_CRASH"
  | "SUBSCRIPTION_LOST"
  | "BINDING_REVOKED"
  | "SUPERSEDED";

export interface TerminalState {
  readonly reason: TerminalReason;
  readonly finishedAt: number;
  readonly detail?: string;
}

export function completed(text: string, now = Date.now()): TerminalState {
  return Object.freeze({
    reason: text.length === 0 ? "COMPLETED_EMPTY" : "COMPLETED",
    finishedAt: now,
  });
}
