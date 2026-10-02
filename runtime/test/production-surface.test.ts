import { expect, test } from "bun:test";
import * as production from "../src/index.js";
import * as compatibility from "../src/compat.js";

test("the Bot's native runtime constructors remain available without v2 transport adapters", () => {
  for (const name of ["RailwayResourceGovernor", "TemporarySessionRunner", "GrammyRichMessagePort",
    "GrammyNativeMarkdownStreamPort", "OpenCodeTopicWorker", "TelegramNativeCore", "DeadlineExceededError"] as const) {
    expect(typeof production[name]).toBe("function");
  }
  expect("OpenCodeSessionClient" in production).toBe(false);
  expect("SessionEventPump" in production).toBe(false);
  expect("consumeWorkerJsonLines" in production).toBe(false);
  expect("AuthoritativeRunReconciler" in production).toBe(false);
  expect("TELEGRAM_CONFORMANCE" in production).toBe(false);
  expect(typeof compatibility.OpenCodeSessionClient).toBe("function");
  expect(typeof compatibility.SessionEventPump).toBe("function");
});
