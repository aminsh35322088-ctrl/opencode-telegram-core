export interface RuntimeEventOwner {
  readonly sessionId: string;
  readonly runId: string;
  readonly directory: string;
}

/** Captured by the runtime publisher, never inferred from the current native run. */
export interface ExecutionEventOrigin {
  readonly version: 1;
  readonly root: RuntimeEventOwner;
  readonly producer: RuntimeEventOwner;
  readonly epoch: number;
}

export function parseExecutionEventOrigin(value: unknown): ExecutionEventOrigin | null {
  try {
    const input = record(value);
    if (!input || input.version !== 1 || !Number.isSafeInteger(input.epoch) || (input.epoch as number) < 0) return null;
    const root = owner(input.root);
    const producer = owner(input.producer);
    if (!root || !producer || root.directory !== producer.directory) return null;
    if (root.sessionId === producer.sessionId && root.runId !== producer.runId) return null;
    return Object.freeze({ version: 1, root, producer, epoch: input.epoch as number });
  } catch {
    return null;
  }
}

function owner(value: unknown): RuntimeEventOwner | null {
  const input = record(value);
  if (!input || !text(input.sessionId) || !text(input.runId) || !text(input.directory)) return null;
  return Object.freeze({ sessionId: input.sessionId, runId: input.runId, directory: input.directory });
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
