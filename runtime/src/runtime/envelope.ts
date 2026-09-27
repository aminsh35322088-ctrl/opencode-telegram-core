import type { RunIdentity } from "./identity.js";

export interface InboundEnvelope<T = unknown> extends RunIdentity {
  readonly operationId: string;
  readonly updateId?: number;
  readonly operation: string;
  readonly payload: T;
}

export interface OutboundEnvelope<T = unknown> extends RunIdentity {
  readonly operationId: string;
  readonly kind: string;
  readonly payload: T;
}
