import { describe, expect, test } from "bun:test";
import { Api } from "grammy";
import {
  RailwayResourceGovernor,
  TELEGRAM_CONFORMANCE,
  requireModelAdmission,
  telegramRouteKey,
  type TelegramRoute,
} from "../src/index.js";

describe("Telegram 10.3 conformance surface", () => {
  test("pinned frontier methods exist on grammY raw API", () => {
    const api = new Api("123456:TEST_TOKEN");
    expect(typeof api.raw.sendRichMessage).toBe("function");
    expect(typeof api.raw.sendRichMessageDraft).toBe("function");
    expect(typeof api.raw.answerGuestQuery).toBe("function");
    expect(typeof api.raw.getManagedBotToken).toBe("function");
    expect(typeof api.raw.replaceManagedBotToken).toBe("function");
    expect(TELEGRAM_CONFORMANCE.botApiVersion).toBe("10.3");
    expect(TELEGRAM_CONFORMANCE.grammyVersion).toBe("1.46.0");
  });

  test("all supported route domains produce distinct stable keys", () => {
    const routes: TelegramRoute[] = [
      { kind: "chat", botId: "bot", chatId: 10 },
      { kind: "topic", botId: "bot", chatId: 10, threadId: 20 },
      { kind: "direct_messages_topic", botId: "bot", chatId: 10, directMessagesTopicId: 20 },
      { kind: "business", botId: "bot", businessConnectionId: "biz", chatId: 10, threadId: 20 },
      { kind: "inline", botId: "bot", userId: 10, inlineQueryId: "q" },
      { kind: "guest", botId: "bot", guestQueryId: "guest", chatId: 10 },
    ];
    const keys = routes.map(telegramRouteKey);
    expect(new Set(keys).size).toBe(routes.length);
  });

  test("General/control-only behavior is injected policy rather than a hard-coded Core fallback", async () => {
    const route: TelegramRoute = { kind: "chat", botId: "bot", chatId: 10 };
    const allowed = await requireModelAdmission(
      ({ operation }) => operation === "model.prompt" ? "CONTROL_ONLY" : "MODEL_ALLOWED",
      { route, operation: "model.prompt" },
    );
    expect(allowed).toBe(false);
  });
});

describe("Railway resource governor", () => {
  const policy = {
    softRssBytes: 700,
    hardRssBytes: 900,
    maxWorkers: 3,
    maxRestartsPerBinding: 2,
    restartWindowMs: 1_000,
  };

  test("prefers idle eviction under soft memory pressure", () => {
    const governor = new RailwayResourceGovernor(policy);
    expect(governor.evaluate({ rssBytes: 750, workerCount: 2, idleWorkerCount: 1 })).toBe("EVICT_IDLE");
    expect(governor.evaluate({ rssBytes: 750, workerCount: 2, idleWorkerCount: 0 })).toBe("REJECT_NEW_WORK");
    expect(governor.evaluate({ rssBytes: 950, workerCount: 1, idleWorkerCount: 1 })).toBe("EMERGENCY_SHUTDOWN");
  });

  test("restart storm is bounded independently per binding", () => {
    let now = 10_000;
    const governor = new RailwayResourceGovernor(policy, () => now);
    expect(governor.permitRestart("a")).toBe(true);
    expect(governor.permitRestart("a")).toBe(true);
    expect(governor.permitRestart("a")).toBe(false);
    expect(governor.permitRestart("b")).toBe(true);
    now += 1_001;
    expect(governor.permitRestart("a")).toBe(true);
  });

  test("pruning a drained window never re-opens a burst that is still inside it", () => {
    let now = 10_000;
    const governor = new RailwayResourceGovernor(policy, () => now);
    // Saturate the window for this binding.
    while (governor.permitRestart("a")) { /* fill to the ceiling */ }
    // Every further attempt inside the same window must stay refused,
    // including the calls that prune the (now empty) filtered list.
    for (let i = 0; i < 5; i += 1) {
      expect(governor.permitRestart("a")).toBe(false);
    }
    // Once the window has genuinely drained, the binding is admitted again.
    now += policy.restartWindowMs + 1;
    expect(governor.permitRestart("a")).toBe(true);
  });
});
