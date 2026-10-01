import type { BindingRegistry } from "./binding-registry.js";
import type { OutboundEnvelope } from "./envelope.js";
import type { RunRegistry } from "./run-registry.js";

export interface OutboundSink {
  send(envelope: OutboundEnvelope): Promise<void>;
}

export class OutboundGateway {
  constructor(
    private readonly bindings: BindingRegistry,
    private readonly runs: RunRegistry,
    private readonly sink: OutboundSink,
  ) {}

  async dispatch(envelope: OutboundEnvelope): Promise<boolean> {
    if (!this.bindings.getExact(envelope)) return false;
    if (!this.runs.accepts(envelope)) return false;
    try {
      const activity = this.runs.activity(envelope);
      do { await activity.checkpoint(); } while (activity.paused);
    } catch { return false; }
    if (!this.bindings.getExact(envelope) || !this.runs.accepts(envelope)) return false;
    await this.sink.send(envelope);
    return true;
  }
}
