// Image-installed adapter: all process authority comes from the live Core context.
const actions = ["open", "goto", "back", "forward", "reload", "snapshot", "screenshot",
  "click", "fill", "type", "press", "hover", "check", "uncheck", "select", "close",
  "tab-list", "tab-new", "tab-select", "tab-close", "requests", "console", "pdf"];
export default {
  description: "Use the Topic-owned governed browser. Open first; snapshot before using element refs.",
  args: {
    action: {type: "string", enum: actions}, url: {type: "string"}, ref: {type: "string"},
    text: {type: "string"}, filename: {type: "string"}, session: {type: "string"},
  },
  async execute(args, context) {
    if (!actions.includes(args.action)) throw new Error("Unsupported browser action");
    if (!context.process?.browser) throw new Error("Governed browser capability is unavailable");
    const parameters = [];
    if (args.action === "open") parameters.push(args.url || "about:blank");
    else if (["goto", "tab-new"].includes(args.action) && args.url) parameters.push(args.url);
    if (["goto", "tab-new"].includes(args.action) && !args.url) throw new Error("URL is required");
    if (["click", "hover", "check", "uncheck", "screenshot"].includes(args.action) && args.ref) parameters.push(args.ref);
    if (["fill", "select"].includes(args.action)) {
      if (!args.ref || args.text === undefined) throw new Error("Ref and text are required");
      parameters.push(args.ref, args.text);
    }
    if (["type", "press", "tab-select", "tab-close"].includes(args.action)) {
      if (args.text === undefined) throw new Error("Text is required");
      parameters.push(args.text);
    }
    const result = await context.process.browser({action: args.action, args: parameters,
      session: args.session, filename: args.filename, timeout: 120000, maxBuffer: 2 * 1024 * 1024});
    return [result.stdout, result.stderr].filter(Boolean).join("\n");
  },
};
