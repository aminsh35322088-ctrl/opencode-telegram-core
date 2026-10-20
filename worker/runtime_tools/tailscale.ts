export default {
  description: "Topic-scoped Tailnet status, eligible-device discovery and peer ping. Ping accepts only an online tag:ssh peer visible to this Worker. The managed SSH public key is read from the Control Plane; private key material is never returned.",
  args: {
    action: { type: "string", enum: ["status", "devices", "ping", "ssh-public-key"] },
    target: { type: "string" },
  },
  async execute(args: { action?: string; target?: string }, context: { sessionID: string; process?: { network?: (args: Record<string, unknown>) => Promise<unknown> } }) {
    if (args.action === "ssh-public-key") {
      const response = await fetch("http://127.0.0.1:4098/control", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "telegram.tool", sessionId: context.sessionID, payload: { action: "ssh.public-key" } }),
        signal: AbortSignal.timeout(15_000),
      });
      const value = await response.json().catch(() => null) as { ok?: boolean; result?: unknown } | null;
      if (!response.ok || !value || value.ok !== true) throw new Error("Managed SSH public-key lookup was rejected.");
      return JSON.stringify(value.result, null, 2);
    }
    if (!["status", "devices", "ping"].includes(String(args.action))) throw new Error("Unsupported Tailscale action.");
    if (args.action === "ping" && (!args.target || args.target.length > 255)) throw new Error("ping requires a visible Tailnet peer target.");
    if (!context.process?.network) throw new Error("Governed Topic network capability is unavailable.");
    return JSON.stringify(await context.process.network({ action: args.action, ...(args.target ? { target: args.target } : {}) }), null, 2);
  },
};
