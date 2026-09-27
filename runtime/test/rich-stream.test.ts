import { describe, expect, test } from "bun:test";
import {
  BindingRegistry,
  RichStreamFencedError,
  RunRegistry,
  TelegramRichStreamController,
  renderTelegramRichDocument,
  type AgentDocument,
  type BindingIdentity,
  type NativeMarkdownStreamPort,
  type RichDraftRoute,
  type RichMessagePort,
} from "../src/index.js";
import type { InputRichMessageWithoutUpload } from "grammy/types";

function binding(): BindingIdentity {
  return {
    bindingId: "binding-a",
    botId: "bot-main",
    chatId: 100,
    threadId: 11,
    sessionId: "session-a",
    normalizedDirectory: "/workspace/a",
    bindingGeneration: 1,
  };
}

class FakeNativeStreamPort implements NativeMarkdownStreamPort {
  readonly chunks: string[] = [];

  async streamMarkdown(
    _route: RichDraftRoute,
    _draftId: number,
    chunks: AsyncIterable<string> | Iterable<string>,
    options: { readonly signal: AbortSignal; readonly guard: () => boolean },
  ): Promise<void> {
    for await (const chunk of chunks) {
      options.signal.throwIfAborted();
      if (!options.guard()) throw new RichStreamFencedError();
      this.chunks.push(chunk);
    }
  }
}

class FakePort implements RichMessagePort {
  drafts: Array<{ route: RichDraftRoute; draftId: number; message: InputRichMessageWithoutUpload }> = [];
  finals: Array<{ route: RichDraftRoute; message: InputRichMessageWithoutUpload }> = [];

  async sendDraft(
    route: RichDraftRoute,
    draftId: number,
    richMessage: InputRichMessageWithoutUpload,
  ): Promise<void> {
    this.drafts.push({ route, draftId, message: richMessage });
  }

  async sendFinal(route: RichDraftRoute, richMessage: InputRichMessageWithoutUpload): Promise<void> {
    this.finals.push({ route, message: richMessage });
  }
}

describe("Telegram-native rich rendering", () => {
  test("native Rich Markdown is passed through without MarkdownV2 escaping", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const run = runs.start(b, 1, "markdown-run");
    const port = new FakePort();
    const controller = new TelegramRichStreamController(bindings, runs, port, async () => undefined);
    const route = { chatId: 100, messageThreadId: 11 };
    const markdown = "# Heading\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\`\`\`ts\nconst x = 1;\n\`\`\`";

    const draftId = await controller.startMarkdown(run, route, markdown);
    expect(draftId).not.toBeNull();
    expect(port.drafts[0]?.message.markdown).toBe(markdown);
    expect(await controller.finalizeMarkdown(run, route, draftId!, markdown)).toBe(true);
    expect(port.finals[0]?.message.markdown).toBe(markdown);
  });

  test("native streaming revalidates durable binding before every pushed chunk", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const run = runs.start(b, 1, "guarded-stream");
    const port = new FakePort();
    const streamPort = new FakeNativeStreamPort();
    const controller = new TelegramRichStreamController(bindings, runs, port, async () => undefined);
    const route = { chatId: 100, messageThreadId: 11 };

    async function* chunks() {
      yield "first";
      bindings.fence(b.bindingId);
      yield "second";
    }

    expect(await controller.streamMarkdown(run, route, chunks(), streamPort)).toBe(false);
    expect(streamPort.chunks).toEqual(["first"]);
  });

  test("draft supports thinking but final never persists thinking block", () => {
    const document: AgentDocument = {
      blocks: [
        { type: "thinking", text: "Working…" },
        { type: "heading", text: "Result", level: 2 },
        { type: "code", text: "console.log('ok')", language: "ts" },
      ],
    };

    const draft = renderTelegramRichDocument(document, { draft: true });
    const final = renderTelegramRichDocument(document, { draft: false });

    expect(draft.blocks?.map((block) => block.type)).toEqual(["thinking", "heading", "pre"]);
    expect(final.blocks?.map((block) => block.type)).toEqual(["heading", "pre"]);
  });

  test("Telegram stop update aborts only the exact draft run", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const run = runs.start(b, 1, "run-a");
    const port = new FakePort();
    const aborted: string[] = [];
    const controller = new TelegramRichStreamController(
      bindings,
      runs,
      port,
      async (target) => { aborted.push(target.runId); },
    );
    const route = { chatId: 100, messageThreadId: 11 };
    const draftId = await controller.start(run, route, {
      blocks: [{ type: "thinking", text: "Working…" }],
    });

    expect(draftId).not.toBeNull();
    expect(await controller.stopped({
      chat: { id: 100 },
      message_thread_id: 11,
      draft_id: draftId!,
    })).toBe(true);
    expect(aborted).toEqual(["run-a"]);
  });

  test("late draft update from superseded run is dropped", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const oldRun = runs.start(b, 1, "old");
    const port = new FakePort();
    const controller = new TelegramRichStreamController(bindings, runs, port, async () => undefined);
    const route = { chatId: 100, messageThreadId: 11 };
    const draftId = await controller.start(oldRun, route, {
      blocks: [{ type: "paragraph", text: "old" }],
    });
    runs.start(b, 1, "new");

    expect(await controller.update(oldRun, route, draftId!, {
      blocks: [{ type: "paragraph", text: "late" }],
    })).toBe(false);
    expect(port.drafts).toHaveLength(1);
  });
});
