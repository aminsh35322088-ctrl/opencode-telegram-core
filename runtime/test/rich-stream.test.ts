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
    const blocks = port.finals[0]?.message.blocks ?? [];
    expect(blocks.map((block) => block.type)).toEqual(["heading", "table", "pre"]);
    expect((blocks[2] as { language?: string }).language).toBe("ts");
  });

  test("final Markdown larger than one Rich Message persists as fenced native chunks", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const run = runs.start(b, 1, "large-final");
    const port = new FakePort();
    const controller = new TelegramRichStreamController(bindings, runs, port, async () => undefined);
    const route = { chatId: 100, messageThreadId: 11 };
    const markdown = "word ".repeat(9000);

    const draftId = await controller.startMarkdown(run, route, "working");
    expect(draftId).not.toBeNull();
    expect(await controller.finalizeMarkdown(run, route, draftId!, markdown)).toBe(true);
    expect(port.finals.length).toBeGreaterThan(1);
    expect(port.finals.every((item) => item.message.blocks !== undefined)).toBe(true);
  });

  test("multi-message finalization stops before a late chunk after the binding is fenced", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const run = runs.start(b, 1, "fenced-final");
    const route = { chatId: 100, messageThreadId: 11 };
    let finals = 0;
    const port: RichMessagePort = {
      async sendDraft() {},
      async sendFinal() {
        finals += 1;
        if (finals === 1) bindings.fence(b.bindingId);
      },
    };
    const controller = new TelegramRichStreamController(bindings, runs, port, async () => undefined);

    const draftId = await controller.startMarkdown(run, route, "working");
    expect(draftId).not.toBeNull();
    const result = await controller.finalizeMarkdown(run, route, draftId!, "word ".repeat(9000));
    expect(result).toBe(false);
    expect(finals).toBe(1);
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

describe("draft lease failure cleanup", () => {
  test("a failed initial draft send does not reserve the deterministic draft id", async () => {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const run = runs.start(b, 1, "send-failure");
    const route = { chatId: 100, messageThreadId: 11 };
    const attempted: number[] = [];
    let fail = true;
    const port: RichMessagePort = {
      async sendDraft(_route, draftId) {
        attempted.push(draftId);
        if (fail) {
          fail = false;
          throw new Error("draft network failure");
        }
      },
      async sendFinal() {},
    };
    const controller = new TelegramRichStreamController(bindings, runs, port, async () => undefined);

    await expect(controller.startMarkdown(run, route, "first")).rejects.toThrow("draft network failure");
    const retried = await controller.startMarkdown(run, route, "second");
    expect(retried).toBe(attempted[0]!);
  });
});

describe("streamed draft lease lifetime", () => {
  function setup() {
    const bindings = new BindingRegistry();
    const b = binding();
    bindings.register(b);
    const runs = new RunRegistry();
    const run = runs.start(b, 1, "stream-lease");
    const port = new FakePort();
    const controller = new TelegramRichStreamController(bindings, runs, port, async () => undefined);
    const route = { chatId: 100, messageThreadId: 11 };
    return { bindings, b, runs, run, port, controller, route };
  }

  test("a streamed draft can be persisted afterwards", async () => {
    const { run, port, controller, route } = setup();
    let draftId = 0;
    await controller.streamMarkdown(run, route, ["hello "], {
      async streamMarkdown(_route: RichDraftRoute, id: number) { draftId = id; },
    } as never);

    // A draft is an ephemeral preview; only a separate final send persists it.
    const persisted = await controller.finalizeMarkdown(run, route, draftId, "hello world");
    expect(persisted).toBe(true);
    expect(port.finals).toHaveLength(1);
    expect(port.finals[0]?.message.blocks).toEqual([
      { type: "paragraph", text: "hello world" },
    ]);
  });

  test("a fenced stream leaves no lease and no final message", async () => {
    const { run, port, controller, route } = setup();
    let draftId = 0;
    const fenced = await controller.streamMarkdown(run, route, ["x"], {
      async streamMarkdown(_route: RichDraftRoute, id: number) {
        draftId = id;
        throw new RichStreamFencedError();
      },
    } as never);

    expect(fenced).toBe(false);
    expect(await controller.finalizeMarkdown(run, route, draftId, "x")).toBe(false);
    expect(port.finals).toHaveLength(0);
  });

  test("a non-fence error propagates and still leaves no lease", async () => {
    const { run, port, controller, route } = setup();
    let draftId = 0;
    await expect(
      controller.streamMarkdown(run, route, ["x"], {
        async streamMarkdown(_route: RichDraftRoute, id: number) {
          draftId = id;
          throw new Error("network down");
        },
      } as never),
    ).rejects.toThrow("network down");
    expect(await controller.finalizeMarkdown(run, route, draftId, "x")).toBe(false);
    expect(port.finals).toHaveLength(0);
  });

  test("a superseded run cannot finalize the draft it streamed", async () => {
    const { bindings, b, runs, run, port, controller, route } = setup();
    let draftId = 0;
    const result = await controller.streamMarkdown(run, route, ["x"], {
      async streamMarkdown(_route: RichDraftRoute, id: number) {
        draftId = id;
        bindings.fence(b.bindingId);
        runs.start({ ...b, bindingGeneration: 2 }, 1, "replacement");
      },
    } as never);

    expect(result).toBe(false);
    expect(await controller.finalizeMarkdown(run, route, draftId, "x")).toBe(false);
    expect(port.finals).toHaveLength(0);
  });

  test("releaseDraft drops the lease without sending anything", async () => {
    const { run, port, controller, route } = setup();
    let draftId = 0;
    await controller.streamMarkdown(run, route, ["x"], {
      async streamMarkdown(_route: RichDraftRoute, id: number) { draftId = id; },
    } as never);

    expect(controller.releaseDraft(run, route, draftId)).toBe(true);
    expect(await controller.finalizeMarkdown(run, route, draftId, "x")).toBe(false);
    expect(port.finals).toHaveLength(0);
    expect(port.drafts).toHaveLength(0);
  });

  test("releaseRun clears every lease owned by the completed run", async () => {
    const { run, port, controller, route } = setup();
    let draftId = 0;
    await controller.streamMarkdown(run, route, ["x"], {
      async streamMarkdown(_route: RichDraftRoute, id: number) { draftId = id; },
    } as never);

    expect(controller.releaseRun(run)).toBe(1);
    expect(controller.releaseRun(run)).toBe(0);
    expect(await controller.finalizeMarkdown(run, route, draftId, "x")).toBe(false);
    expect(port.finals).toHaveLength(0);
  });

  test("a run that becomes stale before finalize drops its retained lease", async () => {
    const { b, runs, run, controller, route } = setup();
    let draftId = 0;
    await controller.streamMarkdown(run, route, ["x"], {
      async streamMarkdown(_route: RichDraftRoute, id: number) { draftId = id; },
    } as never);

    runs.start(b, 1, "replacement");
    expect(await controller.finalizeMarkdown(run, route, draftId, "x")).toBe(false);
    expect(controller.releaseRun(run)).toBe(0);
  });

  test("releaseDraft is idempotent and rejects a foreign run", async () => {
    const { run, controller, route } = setup();
    let draftId = 0;
    await controller.streamMarkdown(run, route, ["x"], {
      async streamMarkdown(_route: RichDraftRoute, id: number) { draftId = id; },
    } as never);

    expect(controller.releaseDraft({ ...run, runId: "someone-else" }, route, draftId)).toBe(false);
    expect(controller.releaseDraft({ ...run, workerGeneration: run.workerGeneration + 1 }, route, draftId)).toBe(false);
    expect(controller.releaseDraft(run, route, draftId)).toBe(true);
    expect(controller.releaseDraft(run, route, draftId)).toBe(false);
  });
});
