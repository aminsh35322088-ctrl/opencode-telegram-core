import type { InputRichMessageWithoutUpload } from "grammy/types";
import type { AgentDocument } from "../presentation/agent-document.js";
import { renderTelegramRichDocument, renderTelegramRichMarkdown } from "../presentation/telegram-rich-renderer.js";
import type { BindingRegistry } from "../runtime/binding-registry.js";
import { sameRun, type RunIdentity } from "../runtime/identity.js";
import type { RunRegistry } from "../runtime/run-registry.js";

export interface RichDraftRoute {
  readonly chatId: number;
  readonly messageThreadId?: number;
}

export interface GenerationStoppedEvent {
  readonly chat: { readonly id: number };
  readonly message_thread_id?: number;
  readonly draft_id: number;
}

export interface RichMessagePort {
  sendDraft(
    route: RichDraftRoute,
    draftId: number,
    richMessage: InputRichMessageWithoutUpload,
    signal?: AbortSignal,
  ): Promise<void>;
  sendFinal(
    route: RichDraftRoute,
    richMessage: InputRichMessageWithoutUpload,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface NativeMarkdownStreamPort {
  streamMarkdown(
    route: RichDraftRoute,
    draftId: number,
    chunks: AsyncIterable<string> | Iterable<string>,
    options: {
      readonly signal: AbortSignal;
      readonly guard: () => boolean;
    },
  ): Promise<void>;
}

export class RichStreamFencedError extends Error {
  constructor() {
    super("rich stream fencing rejected outbound Telegram mutation");
    this.name = "RichStreamFencedError";
  }
}

interface DraftLease {
  readonly run: RunIdentity;
  readonly route: RichDraftRoute;
  readonly draftId: number;
  readonly controller?: AbortController;
}

function routeKey(route: RichDraftRoute, draftId: number): string {
  return route.chatId + ":" + (route.messageThreadId ?? 0) + ":" + draftId;
}

function baseDraftId(runId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < runId.length; i += 1) {
    hash ^= runId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 1) || 1;
}

export class TelegramRichStreamController {
  readonly #leases = new Map<string, DraftLease>();

  constructor(
    private readonly bindings: BindingRegistry,
    private readonly runs: RunRegistry,
    private readonly port: RichMessagePort,
    private readonly abortRun: (run: RunIdentity, reason: "telegram_stop") => Promise<void>,
    /**
     * Completes the run. Defaults to the bare registry, which skips the
     * per-run liveness and stuck bookkeeping the core normally performs.
     */
    private readonly finishRun: (run: RunIdentity) => void = (run) => {
      this.runs.finish(run);
    },
  ) {}

  async start(
    run: RunIdentity,
    route: RichDraftRoute,
    document: AgentDocument,
    signal?: AbortSignal,
  ): Promise<number | null> {
    if (!this.#accepts(run)) return null;
    const draftId = this.#allocateDraftId(run, route);
    const key = routeKey(route, draftId);
    const lease: DraftLease = { run, route, draftId };
    this.#leases.set(key, lease);
    try {
      await this.port.sendDraft(route, draftId, renderTelegramRichDocument(document, { draft: true }), signal);
    } catch (error) {
      this.#dropLease(key, lease, "Draft send failed");
      throw error;
    }
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Draft fenced after send");
      return null;
    }
    return draftId;
  }

  async startMarkdown(
    run: RunIdentity,
    route: RichDraftRoute,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<number | null> {
    if (!this.#accepts(run)) return null;
    const draftId = this.#allocateDraftId(run, route);
    const key = routeKey(route, draftId);
    const lease: DraftLease = { run, route, draftId };
    this.#leases.set(key, lease);
    try {
      await this.port.sendDraft(route, draftId, renderTelegramRichMarkdown(markdown), signal);
    } catch (error) {
      this.#dropLease(key, lease, "Draft send failed");
      throw error;
    }
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Draft fenced after send");
      return null;
    }
    return draftId;
  }


  async streamMarkdown(
    run: RunIdentity,
    route: RichDraftRoute,
    chunks: AsyncIterable<string> | Iterable<string>,
    streamPort: NativeMarkdownStreamPort,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.#accepts(run)) return false;
    const draftId = this.#allocateDraftId(run, route);
    const controller = new AbortController();
    const combinedSignal = signal === undefined
      ? controller.signal
      : AbortSignal.any([signal, controller.signal]);
    const key = routeKey(route, draftId);
    const lease: DraftLease = { run, route, draftId, controller };
    this.#leases.set(key, lease);

    try {
      await streamPort.streamMarkdown(route, draftId, chunks, {
        signal: combinedSignal,
        guard: () => {
          const current = this.#leases.get(key);
          return current === lease && this.#accepts(run);
        },
      });
    } catch (error) {
      this.#dropLease(key, lease, "Draft stream failed");
      if (error instanceof RichStreamFencedError) return false;
      throw error;
    }

    // A streamed draft is only an ephemeral preview: the Bot API requires a
    // separate sendRichMessage to persist the answer. The lease must therefore
    // outlive the stream so finalize()/finalizeMarkdown() can still find it.
    // A run that stopped being current releases it here, because no finalize
    // could follow, and releaseDraft() covers a stream that ends unfinalized.
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Draft stream fenced");
      return false;
    }
    return true;
  }

  /**
   * Drops a draft lease without persisting anything, and aborts the stream it
   * was holding open. Call this when a stream ends without a finalized
   * message, so leases do not accumulate per draft.
   */
  releaseDraft(run: RunIdentity, route: RichDraftRoute, draftId: number): boolean {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run)) return false;
    this.#dropLease(key, lease, "Draft released");
    return true;
  }

  releaseRun(run: RunIdentity): number {
    let released = 0;
    for (const [key, lease] of this.#leases) {
      if (!sameRun(lease.run, run)) continue;
      if (this.#dropLease(key, lease, "Run finished")) released += 1;
    }
    return released;
  }

  releaseBinding(bindingId: string): number {
    let released = 0;
    for (const [key, lease] of this.#leases) {
      if (lease.run.bindingId !== bindingId) continue;
      if (this.#dropLease(key, lease, "Binding fenced")) released += 1;
    }
    return released;
  }

  async updateMarkdown(
    run: RunIdentity,
    route: RichDraftRoute,
    draftId: number,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run)) return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft update");
      return false;
    }
    await this.port.sendDraft(route, draftId, renderTelegramRichMarkdown(markdown), signal);
    return true;
  }

  async finalizeMarkdown(
    run: RunIdentity,
    route: RichDraftRoute,
    draftId: number,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run)) return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft finalize");
      return false;
    }
    await this.port.sendFinal(route, renderTelegramRichMarkdown(markdown), signal);
    this.#dropLease(key, lease, "Draft finalized");
    return true;
  }

  async update(
    run: RunIdentity,
    route: RichDraftRoute,
    draftId: number,
    document: AgentDocument,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run)) return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft update");
      return false;
    }
    await this.port.sendDraft(route, draftId, renderTelegramRichDocument(document, { draft: true }), signal);
    return true;
  }

  async finalize(
    run: RunIdentity,
    route: RichDraftRoute,
    draftId: number,
    document: AgentDocument,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run)) return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft finalize");
      return false;
    }
    await this.port.sendFinal(route, renderTelegramRichDocument(document, { draft: false }), signal);
    this.#dropLease(key, lease, "Draft finalized");
    return true;
  }

  async stopped(event: GenerationStoppedEvent): Promise<boolean> {
    const route: RichDraftRoute = event.message_thread_id === undefined
      ? { chatId: event.chat.id }
      : { chatId: event.chat.id, messageThreadId: event.message_thread_id };
    const key = routeKey(route, event.draft_id);
    const lease = this.#leases.get(key);
    if (!lease) return false;
    if (!this.#accepts(lease.run)) {
      this.#dropLease(key, lease, "Stale stop event");
      return false;
    }
    this.#dropLease(key, lease, "Telegram generation stopped");
    // Fence the run before the network interrupt so late SSE/tool/Telegram
    // completions cannot race the user's Stop action.
    this.finishRun(lease.run);
    await this.abortRun(lease.run, "telegram_stop");
    return true;
  }

  #dropLease(key: string, lease: DraftLease, reason: string): boolean {
    if (this.#leases.get(key) !== lease) return false;
    this.#leases.delete(key);
    lease.controller?.abort(new DOMException(reason, "AbortError"));
    return true;
  }

  #accepts(run: RunIdentity): boolean {
    return this.bindings.getExact(run) !== null && this.runs.accepts(run);
  }

  #allocateDraftId(run: RunIdentity, route: RichDraftRoute): number {
    let candidate = baseDraftId(run.runId);
    while (this.#leases.has(routeKey(route, candidate))) {
      candidate = candidate === 0x7fffffff ? 1 : candidate + 1;
    }
    return candidate;
  }
}
