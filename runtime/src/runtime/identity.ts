export interface BindingIdentity {
  readonly bindingId: string;
  readonly botId: string;
  readonly chatId: number;
  readonly threadId: number;
  readonly sessionId: string;
  readonly normalizedDirectory: string;
  readonly bindingGeneration: number;
}

export interface RunIdentity extends BindingIdentity {
  readonly runId: string;
  readonly workerGeneration: number;
}

export function bindingKey(identity: Pick<BindingIdentity, "botId" | "chatId" | "threadId">): string {
  return `${identity.botId}:${identity.chatId}:${identity.threadId}`;
}

export function sameBinding(a: BindingIdentity, b: BindingIdentity): boolean {
  return (
    a.bindingId === b.bindingId &&
    a.botId === b.botId &&
    a.chatId === b.chatId &&
    a.threadId === b.threadId &&
    a.sessionId === b.sessionId &&
    a.normalizedDirectory === b.normalizedDirectory &&
    a.bindingGeneration === b.bindingGeneration
  );
}

export function sameRun(a: RunIdentity, b: RunIdentity): boolean {
  return sameBinding(a, b) && a.runId === b.runId && a.workerGeneration === b.workerGeneration;
}
