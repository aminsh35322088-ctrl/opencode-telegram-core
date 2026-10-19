// Read-only, Topic-scoped introspection of the live OpenCode tool registry and Worker health.
const sections = ["capabilities", "diagnostics", "verify"];

export default {
  description: "Inspect this Topic's live tool capabilities, runtime diagnostics, or safety/readiness checks. Read-only: never runs commands, reads prompts/files, changes configuration, or exposes credentials.",
  args: { action: { type: "string", enum: sections } },
  async execute(args, context) {
    if (!sections.includes(args.action)) throw new Error("Unsupported runtime inspection action");
    if (typeof context.sessionID !== "string" || !context.sessionID || typeof context.messageID !== "string" || !context.messageID) {
      throw new Error("Runtime inspection requires the captured Topic session and message context");
    }
    const response = await fetch("http://127.0.0.1:4098/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "runtime.inspect",
        payload: { section: args.action, messageID: context.messageID },
        sessionId: context.sessionID,
      }),
    });
    let result;
    try { result = await response.json(); } catch {}
    if (!response.ok || !result || result.ok !== true) {
      throw new Error("Topic runtime inspection was rejected");
    }
    return JSON.stringify(result.result, null, 2);
  },
};
