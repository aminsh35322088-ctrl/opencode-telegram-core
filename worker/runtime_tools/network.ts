export default {
  description: "Connect, inspect, or disconnect this Topic's protected Tailscale identity. Devices lists online tag:ssh peers; SSH requires their exact device ID and a remote username. Network processes retire after each operation, preserving identity for reconnect. No public SSH targets.",
  args: {action:{type:"string",enum:["connect","status","devices","ssh","disconnect","logout"]},
    target:{type:"string"},user:{type:"string"},command:{type:"string"}},
  async execute(args,context) {
    if (!context.process?.network) throw new Error("Governed network capability is unavailable");
    return JSON.stringify(await context.process.network(args));
  },
};
