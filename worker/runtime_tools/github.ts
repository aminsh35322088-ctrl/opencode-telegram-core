export default {
  description: "Authenticated GitHub REST API for this Topic's integrated account. Run the auth-status action first; every other action requires a successfully authenticated account. The access token never enters your shell or session environment.",
  args: {
    action: {type:"string", enum:["auth-status","repo-list","ci-status","api"]},
    method: {type:"string"},
    path: {type:"string"},
    body: {type:"string"},
    owner: {type:"string"},
    repo: {type:"string"},
    ref: {type:"string"}
  },
  async execute(args, context) {
    let method = "GET";
    let path = "/user";
    let body;
    if (args.action === "auth-status") {
      path = "/user";
    } else if (args.action === "repo-list") {
      path = "/user/repos?per_page=30&sort=updated";
    } else if (args.action === "ci-status") {
      if (!args.owner || !args.repo || !args.ref)
        throw new Error("ci-status requires owner, repo and ref arguments");
      path = `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/commits/${encodeURIComponent(args.ref)}/status`;
    } else if (args.action === "api") {
      method = (args.method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("Unsupported GitHub API method.");
      if (!args.path || !args.path.startsWith("/") || args.path.length > 2048 || /[\r\n\0#]/u.test(args.path))
        throw new Error("api requires a safe absolute GitHub API path.");
      path = args.path;
      body = args.body;
      if (method !== "GET") {
        if (typeof context.ask !== "function") throw new Error("Mutating GitHub API calls require explicit Telegram approval.");
        await context.ask({ permission: "github-api-mutation", patterns: [`github-api:${method}:${path}`], always: [], metadata: { input: { method, path, repository: args.owner && args.repo ? `${args.owner}/${args.repo}` : "GitHub account", grantScope: "This request only" } } });
      }
    } else {
      throw new Error("unknown github action");
    }
    const request = {method, path, ...(body !== undefined ? {body} : {})};
    const response = await fetch("http://127.0.0.1:4102/", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(request)
    });
    let result = null;
    try { result = await response.json(); } catch {}
    if (!response.ok || !result || typeof result.status !== "number")
      throw new Error("GitHub session proxy rejected the request");
    if (result.status === 401 || result.status === 403)
      throw new Error("GitHub authentication invalid — run github.auth-status first, or the token lacks permission for this API route.");
    return JSON.stringify(result);
  }
};
