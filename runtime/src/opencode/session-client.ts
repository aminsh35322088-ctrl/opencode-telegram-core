import { abortableSleep, withDeadline } from "../runtime/deadline.js";

export interface DurableIdentity {
  readonly aggregateID: string;
  readonly seq: number;
}

export interface DurableSessionEvent {
  readonly durable: DurableIdentity;
  readonly [key: string]: unknown;
}

export class SessionEventIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionEventIntegrityError";
  }
}

export class SessionEventStreamLostError extends Error {
  constructor(readonly reconnects: number, readonly rootCause: unknown) {
    super("OpenCode session event stream exceeded reconnect budget");
    this.name = "SessionEventStreamLostError";
  }
}

export interface OpenCodeSessionClientOptions {
  readonly baseUrl: string;
  readonly requestTimeoutMs: number;
  readonly eventIdleTimeoutMs: number;
  readonly reconnectDelayMs: number;
  readonly maxReconnects: number;
  readonly fetchImpl?: typeof fetch;
}

export class OpenCodeSessionClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(private readonly options: OpenCodeSessionClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async history(
    sessionId: string,
    after = 0,
    signal?: AbortSignal,
  ): Promise<readonly DurableSessionEvent[]> {
    const result = await this.#requestJson<{ data: DurableSessionEvent[] }>(
      "GET",
      "/api/session/" + encodeURIComponent(sessionId) + "/history?after=" + after,
      undefined,
      signal,
    );
    return result.data;
  }

  async interrupt(sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.#requestJson(
      "POST",
      "/api/session/" + encodeURIComponent(sessionId) + "/interrupt",
      undefined,
      signal,
    );
  }

  async *events(
    sessionId: string,
    after = 0,
    signal?: AbortSignal,
  ): AsyncGenerator<DurableSessionEvent, void, void> {
    let cursor = after;
    let reconnects = 0;

    while (!signal?.aborted) {
      try {
        const response = await this.#connectEvents(sessionId, cursor, signal);
        for await (const event of readSseEvents(response, this.options.eventIdleTimeoutMs, signal)) {
          validateEvent(event, sessionId, cursor);
          if (event.durable.seq <= cursor) continue;
          cursor = event.durable.seq;
          reconnects = 0;
          yield event;
        }
        if (signal?.aborted) return;
        throw new Error("OpenCode SSE stream closed");
      } catch (error) {
        if (signal?.aborted) return;
        reconnects += 1;
        if (reconnects > this.options.maxReconnects) {
          throw new SessionEventStreamLostError(reconnects - 1, error);
        }
        await abortableSleep(this.options.reconnectDelayMs * reconnects, signal);
      }
    }
  }

  async #connectEvents(sessionId: string, after: number, signal?: AbortSignal): Promise<Response> {
    return withDeadline(async (deadlineSignal) => {
      const response = await this.#fetch(
        this.#url("/api/session/" + encodeURIComponent(sessionId) + "/event?after=" + after),
        {
          method: "GET",
          headers: { accept: "text/event-stream" },
          signal: deadlineSignal,
        },
      );
      if (!response.ok) {
        throw new Error("OpenCode event stream returned HTTP " + response.status);
      }
      if (!response.body) {
        throw new Error("OpenCode event stream has no body");
      }
      return response;
    }, {
      timeoutMs: this.options.requestTimeoutMs,
      label: "OpenCode event subscribe",
      ...(signal ? { parentSignal: signal } : {}),
    });
  }

  async #requestJson<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return withDeadline(async (deadlineSignal) => {
      const response = await this.#fetch(this.#url(path), {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: deadlineSignal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error("OpenCode " + method + " " + path + " -> " + response.status + ": " + text);
      }
      const text = await response.text();
      return (text.length === 0 ? undefined : JSON.parse(text)) as T;
    }, {
      timeoutMs: this.options.requestTimeoutMs,
      label: "OpenCode " + method + " " + path,
      ...(signal ? { parentSignal: signal } : {}),
    });
  }

  #url(path: string): string {
    return this.#baseUrl + path;
  }
}

async function* readSseEvents(
  response: Response,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): AsyncGenerator<DurableSessionEvent, void, void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  try {
    while (!signal?.aborted) {
      const read = reader.read();
      const timeout = abortableSleep(idleTimeoutMs, signal).then(() => {
        throw new Error("OpenCode SSE idle timeout");
      });
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([read, timeout]);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.length === 0) {
          if (dataLines.length > 0) {
            yield JSON.parse(dataLines.join("\n")) as DurableSessionEvent;
            dataLines = [];
          }
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function validateEvent(event: DurableSessionEvent, sessionId: string, cursor: number): void {
  const durable = event?.durable;
  if (!durable || durable.aggregateID !== sessionId || !Number.isSafeInteger(durable.seq)) {
    throw new SessionEventIntegrityError("event durable identity does not match session " + sessionId);
  }
  if (durable.seq < 0 || durable.seq < cursor) {
    throw new SessionEventIntegrityError("event sequence moved backwards");
  }
}
