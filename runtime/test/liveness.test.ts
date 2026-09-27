import { describe, expect, test } from "bun:test";
import {
  PerRunStuckDetector,
  RunLivenessTracker,
  RunRegistry,
  type BindingIdentity,
} from "../src/index.js";

function binding(id: string, threadId: number): BindingIdentity {
  return {
    bindingId: id,
    botId: "bot-main",
    chatId: 100,
    threadId,
    sessionId: "session-" + id,
    normalizedDirectory: "/workspace/" + id,
    bindingGeneration: 1,
  };
}

describe("per-run liveness isolation", () => {
  test("active tool suppresses false stall but tool gets its own hard deadline", () => {
    const runs = new RunRegistry();
    const run = runs.start(binding("a", 11), 1, "run-a");
    const tracker = new RunLivenessTracker(runs);
    expect(tracker.start(run, 0)).toBe(true);
    expect(tracker.toolStarted(run, "tool-1", 100)).toBe(true);

    expect(tracker.assess(run, {
      now: 5_000,
      stallAfterMs: 1_000,
      toolTimeoutMs: 10_000,
    })).toBe("healthy");

    expect(tracker.assess(run, {
      now: 11_000,
      stallAfterMs: 1_000,
      toolTimeoutMs: 10_000,
    })).toBe("tool_timeout");
  });

  test("late activity from superseded run cannot refresh replacement run", () => {
    const runs = new RunRegistry();
    const b = binding("a", 11);
    const oldRun = runs.start(b, 1, "old");
    const tracker = new RunLivenessTracker(runs);
    tracker.start(oldRun, 0);
    const replacement = runs.start(b, 1, "new");
    tracker.start(replacement, 1_000);

    expect(tracker.touch(oldRun, 9_000)).toBe(false);
    expect(tracker.assess(replacement, {
      now: 3_000,
      stallAfterMs: 1_000,
      toolTimeoutMs: 10_000,
    })).toBe("stalled");
  });
});

describe("per-run stuck detector", () => {
  test("identical tool loop is scoped to one run and one Topic", () => {
    const runs = new RunRegistry();
    const runA = runs.start(binding("a", 11), 1, "run-a");
    const runB = runs.start(binding("b", 22), 1, "run-b");
    const detector = new PerRunStuckDetector(runs, 3);

    expect(detector.observeTool(runA, "grep", { q: "same" })).toBe("ok");
    expect(detector.observeTool(runA, "grep", { q: "same" })).toBe("ok");
    expect(detector.observeTool(runB, "grep", { q: "same" })).toBe("ok");
    expect(detector.observeTool(runA, "grep", { q: "same" })).toBe("stuck");
    expect(detector.observeTool(runB, "grep", { q: "same" })).toBe("ok");
  });

  test("argument key ordering does not evade repeated-call detection", () => {
    const runs = new RunRegistry();
    const run = runs.start(binding("a", 11), 1, "run-a");
    const detector = new PerRunStuckDetector(runs, 2);

    expect(detector.observeTool(run, "read", { a: 1, b: 2 })).toBe("ok");
    expect(detector.observeTool(run, "read", { b: 2, a: 1 })).toBe("stuck");
  });
});
