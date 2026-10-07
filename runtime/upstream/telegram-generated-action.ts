/** Narrow delegated capability: an Action ID is resolved by the bound Worker, never a caller tool name. */
export type GeneratedActionPlan = {
  revision: number;
  id: string;
  risk: "read" | "write" | "external" | "mutating" | "destructive";
  invocation: {
    kind: "native-tool" | "action-tool" | "mcp-tool";
    tool: string;
    server?: string;
    actionArgument?: string;
    actionValue?: string;
    arguments?: Record<string, string>;
  };
  arguments: Record<string, unknown>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const boundedName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 128;

function exactPlan(
  value: unknown,
  id: string,
  args: Record<string, unknown>,
): GeneratedActionPlan {
  if (
    !record(value) ||
    value.id !== id ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !["read", "write", "external", "mutating", "destructive"].includes(
      String(value.risk),
    ) ||
    !record(value.invocation)
  )
    throw new Error("Invalid verified Action plan");
  const invocation = value.invocation;
  if (
    !["native-tool", "action-tool", "mcp-tool"].includes(
      String(invocation.kind),
    ) ||
    !boundedName(invocation.tool) ||
    invocation.tool === "actions"
  )
    throw new Error("Invalid generated Action target");
  const allowed = new Set([
    "kind",
    "tool",
    ...(invocation.kind === "mcp-tool" ? ["server"] : ["arguments"]),
    ...(invocation.kind === "action-tool"
      ? ["actionArgument", "actionValue"]
      : []),
  ]);
  if (Object.keys(invocation).some((key) => !allowed.has(key)))
    throw new Error("Invalid generated Action target fields");
  if (invocation.kind === "mcp-tool" && !boundedName(invocation.server))
    throw new Error("Explicit MCP Action server required");
  const fixed = invocation.arguments ?? {};
  if (!record(fixed) || Object.keys(fixed).length > 16)
    throw new Error("Invalid fixed Action arguments");
  for (const [key, item] of Object.entries(fixed)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) ||
      /secret|token|password|credential|authorization|api.?key/i.test(key) ||
      typeof item !== "string" ||
      item.length > 1024 ||
      /Bearer\s|-----BEGIN .*PRIVATE KEY/i.test(item)
    )
      throw new Error("Invalid fixed Action argument");
    if (Object.hasOwn(args, key))
      throw new Error("Approved fixed Action arguments cannot be overridden");
  }
  const merged = { ...args, ...fixed };
  if (invocation.kind === "action-tool") {
    if (
      typeof invocation.actionArgument !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(invocation.actionArgument) ||
      !boundedName(invocation.actionValue)
    )
      throw new Error("Invalid Action discriminator");
    if (
      Object.hasOwn(args, invocation.actionArgument) ||
      Object.hasOwn(fixed, invocation.actionArgument)
    )
      throw new Error("Approved Action discriminator cannot be overridden");
    merged[invocation.actionArgument] = invocation.actionValue;
  }
  return Object.freeze({
    revision: Number(value.revision),
    id,
    risk: value.risk as GeneratedActionPlan["risk"],
    invocation: Object.freeze(
      structuredClone(invocation),
    ) as GeneratedActionPlan["invocation"],
    arguments: Object.freeze(merged),
  });
}

export function createGeneratedActionInvoker(port: {
  sessionID: string;
  signal: AbortSignal;
  checkpoint: () => Promise<void>;
  resolve: (id: string, args: Record<string, unknown>) => Promise<unknown>;
  authorize: (plan: GeneratedActionPlan) => Promise<void>;
  execute: (plan: GeneratedActionPlan) => Promise<unknown>;
}) {
  return async (
    id: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> => {
    if (
      !port.sessionID ||
      !/^[a-z0-9][a-z0-9._-]{1,127}$/.test(id) ||
      !record(args) ||
      JSON.stringify(args).length > 65536
    )
      throw new Error("Invalid bounded Action invocation");
    port.signal.throwIfAborted();
    const supplied = structuredClone(args);
    await port.checkpoint();
    const plan = exactPlan(await port.resolve(id, supplied), id, supplied);
    await port.authorize(plan);
    port.signal.throwIfAborted();
    await port.checkpoint();
    const result = await port.execute(plan);
    await port.checkpoint();
    return result;
  };
}
