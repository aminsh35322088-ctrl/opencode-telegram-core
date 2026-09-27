import { WorkerOutboundGate, WorkerProtocolError } from "./worker-outbound-gate.js";

export interface WorkerChannelStats {
  readonly accepted: number;
  readonly rejected: number;
  readonly protocolErrors: number;
}

export async function consumeWorkerJsonLines(
  stream: ReadableStream<Uint8Array>,
  gate: WorkerOutboundGate,
): Promise<WorkerChannelStats> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accepted = 0;
  let rejected = 0;
  let protocolErrors = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        const outcome = await consumeLine(line, gate);
        accepted += outcome === "accepted" ? 1 : 0;
        rejected += outcome === "rejected" ? 1 : 0;
        protocolErrors += outcome === "protocol_error" ? 1 : 0;
      }
    }
    const tail = buffer.trim();
    if (tail.length > 0) {
      const outcome = await consumeLine(tail, gate);
      accepted += outcome === "accepted" ? 1 : 0;
      rejected += outcome === "rejected" ? 1 : 0;
      protocolErrors += outcome === "protocol_error" ? 1 : 0;
    }
  } finally {
    reader.releaseLock();
  }

  return { accepted, rejected, protocolErrors };
}

async function consumeLine(
  line: string,
  gate: WorkerOutboundGate,
): Promise<"accepted" | "rejected" | "protocol_error"> {
  try {
    const value: unknown = JSON.parse(line);
    return await gate.accept(value) ? "accepted" : "rejected";
  } catch (error) {
    if (error instanceof WorkerProtocolError || error instanceof SyntaxError) {
      return "protocol_error";
    }
    throw error;
  }
}
