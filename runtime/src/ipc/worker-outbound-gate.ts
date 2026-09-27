import type { OutboundEnvelope } from "../runtime/envelope.js";
import type { OutboundGateway } from "../runtime/outbound-gateway.js";

export class WorkerProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerProtocolError";
  }
}

export interface WorkerLease {
  readonly bindingId: string;
  readonly workerGeneration: number;
}

export class WorkerOutboundGate {
  constructor(
    private readonly lease: WorkerLease,
    private readonly gateway: OutboundGateway,
  ) {}

  async accept(value: unknown): Promise<boolean> {
    const envelope = parseOutboundEnvelope(value);
    if (
      envelope.bindingId !== this.lease.bindingId ||
      envelope.workerGeneration !== this.lease.workerGeneration
    ) {
      return false;
    }
    return this.gateway.dispatch(envelope);
  }
}

export function parseOutboundEnvelope(value: unknown): OutboundEnvelope {
  if (!isRecord(value)) throw new WorkerProtocolError("outbound envelope must be an object");

  const requiredStrings = [
    "bindingId",
    "botId",
    "sessionId",
    "normalizedDirectory",
    "runId",
    "operationId",
    "kind",
  ] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new WorkerProtocolError("invalid outbound envelope field: " + field);
    }
  }

  const requiredIntegers = [
    "chatId",
    "threadId",
    "bindingGeneration",
    "workerGeneration",
  ] as const;
  for (const field of requiredIntegers) {
    if (!Number.isSafeInteger(value[field])) {
      throw new WorkerProtocolError("invalid outbound envelope field: " + field);
    }
  }

  if ((value.bindingGeneration as number) < 1 || (value.workerGeneration as number) < 1) {
    throw new WorkerProtocolError("generations must be positive");
  }
  if (!Object.hasOwn(value, "payload")) {
    throw new WorkerProtocolError("outbound envelope payload is required");
  }

  return Object.freeze({
    bindingId: value.bindingId as string,
    botId: value.botId as string,
    chatId: value.chatId as number,
    threadId: value.threadId as number,
    sessionId: value.sessionId as string,
    normalizedDirectory: value.normalizedDirectory as string,
    bindingGeneration: value.bindingGeneration as number,
    runId: value.runId as string,
    workerGeneration: value.workerGeneration as number,
    operationId: value.operationId as string,
    kind: value.kind as string,
    payload: value.payload,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
