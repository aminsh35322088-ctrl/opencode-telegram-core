import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
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


test("multi-Topic internals are not exported from the production package surface", () => {
  for (const name of [
    "AtomicBindingStore",
    "BindingRegistry",
    "WorkerSupervisor",
    "SessionEventRouter",
    "ScheduledTaskDispatcher",
    "TelegramRichStreamController",
  ] as const) {
    expect(name in production).toBe(false);
  }
  // Temporary compatibility for the current Bot pin; Task 7 removes these consumers.
  expect(typeof production.OpenCodeTopicWorker).toBe("function");
  expect(typeof production.TelegramNativeCore).toBe("function");
});

test("the Railway Worker production path owns one slot and never imports multiplex runtime machinery", () => {
  const worker = readFileSync(path.resolve(import.meta.dir, "../../worker/node_agent.py"), "utf8");
  expect(worker).toContain("SingleSlotRuntime");
  for (const retired of ["AtomicBindingStore", "BindingRegistry", "WorkerSupervisor", "TelegramNativeCore", "OpenCodeTopicWorker"]) {
    expect(worker).not.toContain(retired);
  }
});
