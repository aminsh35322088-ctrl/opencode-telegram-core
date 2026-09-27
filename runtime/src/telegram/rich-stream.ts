import type { InputRichMessageWithoutUpload } from "grammy/types";
import type { AgentDocument } from "../presentation/agent-document.js";
import { renderTelegramRichDocument, renderTelegramRichMarkdown } from "../presentation/telegram-rich-renderer.js";
import type { RunIdentity } from "../runtime/identity.js";
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

interface DraftLease {
  readonly run: RunIdentity;
  readonly route: RichDraftRoute;
  readonly draftId: number;
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
    private readonly runs: RunRegistry,
    private readonly port: RichMessagePort,
    private readonly abortRun: (run: RunIdentity, reason: "telegram_stop") => Promise<void>,
  ) {}

  async start(
    run: RunIdentity,
    route: RichDraftRoute,
    document: AgentDocument,
    signal?: AbortSignal,
  ): Promise<number | null> {
    if (!this.runs.accepts(run)) return null;
    const draftId = this.#allocateDraftId(run, route);
    this.#leases.set(routeKey(route, draftId), { run, route, draftId });
    await this.port.sendDraft(route, draftId, renderTelegramRichDocument(document, { draft: true }), signal);
    return draftId;
  }

  async startMarkdown(
    run: RunIdentity,
    route: RichDraftRoute,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<number | null> {
    if (!this.runs.accepts(run)) return null;
    const draftId = this.#allocateDraftId(run, route);
    this.#leases.set(routeKey(route, draftId), { run, route, draftId });
    await this.port.sendDraft(route, draftId, renderTelegramRichMarkdown(markdown), signal);
    return draftId;
  }

  async updateMarkdown(
    run: RunIdentity,
    route: RichDraftRoute,
    draftId: number,
    markdown: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const lease = this.#leases.get(routeKey(route, draftId));
    if (!lease || lease.run.runId !== run.runId || !this.runs.accepts(run)) return false;
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
    if (!lease || lease.run.runId !== run.runId || !this.runs.accepts(run)) return false;
    await this.port.sendFinal(route, renderTelegramRichMarkdown(markdown), signal);
    this.#leases.delete(key);
    return true;
  }

  async update(
    run: RunIdentity,
    route: RichDraftRoute,
    draftId: number,
    document: AgentDocument,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const lease = this.#leases.get(routeKey(route, draftId));
    if (!lease || lease.run.runId !== run.runId || !this.runs.accepts(run)) return false;
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
    if (!lease || lease.run.runId !== run.runId || !this.runs.accepts(run)) return false;
    await this.port.sendFinal(route, renderTelegramRichDocument(document, { draft: false }), signal);
    this.#leases.delete(key);
    return true;
  }

  async stopped(event: GenerationStoppedEvent): Promise<boolean> {
    const route: RichDraftRoute = event.message_thread_id === undefined
      ? { chatId: event.chat.id }
      : { chatId: event.chat.id, messageThreadId: event.message_thread_id };
    const key = routeKey(route, event.draft_id);
    const lease = this.#leases.get(key);
    if (!lease || !this.runs.accepts(lease.run)) return false;
    this.#leases.delete(key);
    await this.abortRun(lease.run, "telegram_stop");
    return true;
  }

  #allocateDraftId(run: RunIdentity, route: RichDraftRoute): number {
    let candidate = baseDraftId(run.runId);
    while (this.#leases.has(routeKey(route, candidate))) {
      candidate = candidate === 0x7fffffff ? 1 : candidate + 1;
    }
    return candidate;
  }
}
