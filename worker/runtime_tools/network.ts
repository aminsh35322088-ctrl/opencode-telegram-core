const sshGrants = new Set<string>();

export default {
  description: "Connect, inspect, or disconnect this Topic's protected Tailscale identity. Devices lists online tag:ssh peers; SSH requires their exact device ID and a remote username and prompts the Telegram operator for approval before connecting. Network processes retire after each operation, preserving identity for reconnect. No public SSH targets.",
  args: {action:{type:"string",enum:["connect","status","devices","ssh","disconnect","logout"]},
    target:{type:"string"},user:{type:"string"},command:{type:"string"}},
  async execute(args,context) {
    if (args?.action === "ssh" && typeof args.target === "string" && args.target.length > 0 && typeof args.user === "string" && args.user.length > 0) {
      const grantKey = `${args.target}:${args.user}`;
      if (!sshGrants.has(grantKey)) {
        await context.ask({
          permission: "ssh-remote",
          patterns: [`tailscale:${args.target}:${args.user}`],
          always: [],
          metadata: {
            input: {
              action: "SSH command on Tailnet server",
              hostname: args.target,
              username: args.user,
              port: 22,
              network: "Tailscale",
              authentication: "Tailscale device authentication",
              password: "Not required",
              grantScope: "This Telegram Topic",
              grantUntil: "This Topic Worker session, unless the target device or username changes",
              requestedAction: "ssh",
              command: typeof args.command === "string" && args.command.length > 0 ? args.command : null,
            },
          },
        });
        sshGrants.add(grantKey);
      }
    }
    if (!context.process?.network) throw new Error("Governed network capability is unavailable");
    return JSON.stringify(await context.process.network(args));
  },
};
