import { expect, test } from "bun:test";
import { createGeneratedActionInvoker } from "@opencode-ai/core/telegram-generated-action";

function fixture() {
  const events: string[] = [];
  let plan: any = {
    revision: 1,
    id: "example.load",
    risk: "read",
    invocation: {
      kind: "native-tool",
      tool: "skill",
      arguments: { name: "example" },
    },
  };
  const invoke = createGeneratedActionInvoker({
    sessionID: "ses_owned",
    signal: new AbortController().signal,
    checkpoint: async () => {
      events.push("checkpoint");
    },
    resolve: async (id, args) => {
      events.push("resolve");
      return plan;
    },
    authorize: async (value) => {
      events.push("ask:" + value.risk);
    },
    execute: async (value) => {
      events.push("execute");
      return value;
    },
  });
  return {
    invoke,
    events,
    setPlan: (value: any) => {
      plan = value;
    },
  };
}

test("generated actions ask before executing an immutable exact target with fixed arguments", async () => {
  const run = fixture();
  const result: any = await run.invoke("example.load", { extra: "value" });
  expect(result.arguments).toEqual({ extra: "value", name: "example" });
  expect(result.invocation.tool).toBe("skill");
  expect(run.events).toEqual([
    "checkpoint",
    "resolve",
    "ask:read",
    "checkpoint",
    "execute",
    "checkpoint",
  ]);
});

test("caller cannot override approved fixed arguments or action discriminator", async () => {
  const run = fixture();
  await expect(run.invoke("example.load", { name: "foreign" })).rejects.toThrow(
    "fixed",
  );
  expect(run.events).not.toContain("execute");
  run.setPlan({
    revision: 1,
    id: "example.load",
    risk: "mutating",
    invocation: {
      kind: "action-tool",
      tool: "bot",
      actionArgument: "action",
      actionValue: "skills.list",
    },
  });
  await expect(
    run.invoke("example.load", { action: "skills.delete" }),
  ).rejects.toThrow("discriminator");
});

test("invalid, recursive and mismatched targets fail before approval or execution", async () => {
  for (const plan of [
    {
      revision: 1,
      id: "foreign",
      risk: "read",
      invocation: { kind: "native-tool", tool: "skill" },
    },
    {
      revision: 1,
      id: "example.load",
      risk: "unknown",
      invocation: { kind: "native-tool", tool: "skill" },
    },
    {
      revision: 1,
      id: "example.load",
      risk: "read",
      invocation: { kind: "native-tool", tool: "actions" },
    },
    {
      revision: 1,
      id: "example.load",
      risk: "read",
      invocation: { kind: "mcp-tool", tool: "delete" },
    },
  ]) {
    const run = fixture();
    run.setPlan(plan);
    await expect(run.invoke("example.load", {})).rejects.toThrow();
    expect(run.events.some((event) => event.startsWith("ask:"))).toBe(false);
    expect(run.events).not.toContain("execute");
  }
});

test("rejected approval and retired checkpoints cannot execute a generated target", async () => {
  const plan: any = {
    revision: 1,
    id: "example.load",
    risk: "destructive",
    invocation: { kind: "native-tool", tool: "write" },
  };
  let executed = false;
  for (const rejected of [true, false]) {
    let checkpoints = 0;
    const invoke = createGeneratedActionInvoker({
      sessionID: "ses_owned",
      signal: new AbortController().signal,
      resolve: async () => plan,
      authorize: async () => {
        if (rejected) throw new Error("rejected");
      },
      checkpoint: async () => {
        if (++checkpoints > 1) throw new Error("retired");
      },
      execute: async () => {
        executed = true;
      },
    });
    await expect(invoke("example.load", {})).rejects.toThrow();
  }
  expect(executed).toBe(false);
});
