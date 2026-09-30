import { describe, expect, test } from "bun:test";
import path from "node:path";
import { TemporarySessionRunner, type TemporarySessionPort } from "../src/index.js";

const owner = { sessionId: "parent", directory: path.resolve("/workspace/topic") };
const child = { sessionId: "temporary", directory: owner.directory, parentSessionId: owner.sessionId };

function fixture(overrides: Partial<TemporarySessionPort> = {}) {
  const calls: string[] = [];
  const port: TemporarySessionPort = {
    get: async () => { calls.push("get"); return owner; },
    create: async () => { calls.push("create"); return child; },
    abort: async () => { calls.push("abort"); },
    remove: async (_target, signal) => { expect(signal.aborted).toBe(false); calls.push("remove"); },
    ...overrides,
  };
  return { calls, runner: new TemporarySessionRunner(port, 20) };
}

describe("Core temporary sessions", () => {
  test("verifies the owner, runs one child, and closes it before returning output", async () => {
    const { runner, calls } = fixture();
    const result = await runner.run(owner, { title: "image", model: { providerID: "p", id: "m" } }, async (session) => {
      expect(session.sessionId).toBe("temporary");
      calls.push("operation");
      return "output";
    }, new AbortController().signal);
    expect(result).toBe("output");
    expect(calls).toEqual(["get", "create", "operation", "abort", "remove"]);
  });

  test("never creates a session for a foreign owner or an already canceled operation", async () => {
    const a = fixture({ get: async () => ({ ...owner, sessionId: "foreign" }) });
    await expect(a.runner.run(owner, { title: "a" }, async () => {}, new AbortController().signal)).rejects.toThrow("owner");
    expect(a.calls).toEqual([]);
    const b = fixture();
    const controller = new AbortController(); controller.abort();
    await expect(b.runner.run(owner, { title: "b" }, async () => {}, controller.signal)).rejects.toThrow();
    expect(b.calls).toEqual([]);
  });

  test("never runs or deletes a foreign child or the owner's root session", async () => {
    for (const invalid of [{ ...child, directory: path.resolve("/workspace/other") }, { ...child, sessionId: owner.sessionId }, { ...child, parentSessionId: "other" }]) {
      const { runner, calls } = fixture({ create: async () => invalid });
      await expect(runner.run(owner, { title: "x" }, async () => calls.push("operation"), new AbortController().signal)).rejects.toThrow("identity");
      expect(calls).toEqual(["get"]);
    }
  });

  test("cleans up a late-created child after cancellation without executing its callback", async () => {
    const controller = new AbortController();
    const { runner, calls } = fixture({ create: async () => { controller.abort(); return child; } });
    await expect(runner.run(owner, { title: "x" }, async () => calls.push("operation"), controller.signal)).rejects.toThrow();
    expect(calls).toEqual(["get", "abort", "remove"]);
  });

  test("reports operation failure after aborting and deleting its exact child", async () => {
    const { runner, calls } = fixture();
    await expect(runner.run(owner, { title: "x" }, async () => { throw new Error("operation failed"); }, new AbortController().signal)).rejects.toThrow("operation failed");
    expect(calls).toEqual(["get", "create", "abort", "remove"]);
  });

  test("retained diagnostic sessions are stopped but remain available for inspection", async () => {
    const { runner, calls } = fixture();
    await runner.run(owner, { title: "x" }, async (session) => { session.retainForInspection(); }, new AbortController().signal);
    expect(calls).toEqual(["get", "create", "abort"]);
  });

  test("bounds and reports cleanup failure rather than returning successful output", async () => {
    let signal!: AbortSignal;
    const { runner, calls } = fixture({ abort: async (_target, cleanupSignal) => { signal = cleanupSignal; return await new Promise<void>(() => {}); } });
    await expect(runner.run(owner, { title: "x" }, async () => "output", new AbortController().signal)).rejects.toThrow("cleanup");
    expect(signal.aborted).toBe(true);
    expect(calls).toContain("remove");
  });

  test("reports both cleanup failures and still attempts deletion after abort failure", async () => {
    const { runner, calls } = fixture({
      abort: async () => { calls.push("abort"); throw new Error("abort failed"); },
      remove: async () => { calls.push("remove"); throw new Error("delete failed"); },
    });
    try {
      await runner.run(owner, { title: "x" }, async () => {}, new AbortController().signal);
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toHaveLength(2);
    }
    expect(calls).toEqual(["get", "create", "abort", "remove"]);
  });

  test("registers ownership before the callback and releases it only after cleanup", async () => {
    const { runner, calls } = fixture();
    await runner.run(owner, { title: "x" }, async () => calls.push("operation"), new AbortController().signal, {
      acquire: (target) => { expect(target.sessionId).toBe("temporary"); calls.push("acquire"); },
      release: () => { calls.push("release"); },
    });
    expect(calls).toEqual(["get", "create", "acquire", "operation", "abort", "remove", "release"]);
  });
});
