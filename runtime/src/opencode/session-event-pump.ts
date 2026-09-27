import type { DurableSessionEvent, OpenCodeSessionClient } from "./session-client.js";
import type { RunIdentity } from "../runtime/identity.js";
import type { RunRegistry } from "../runtime/run-registry.js";

export class SessionEventPump {
  constructor(
    private readonly client: OpenCodeSessionClient,
    private readonly runs: RunRegistry,
  ) {}

  async pump(
    run: RunIdentity,
    after: number,
    onEvent: (event: DurableSessionEvent) => Promise<void> | void,
    signal?: AbortSignal,
  ): Promise<"completed" | "superseded"> {
    for await (const event of this.client.events(run.sessionId, after, signal)) {
      if (!this.runs.accepts(run)) return "superseded";
      await onEvent(event);
      if (!this.runs.accepts(run)) return "superseded";
    }
    return this.runs.accepts(run) ? "completed" : "superseded";
  }
}
