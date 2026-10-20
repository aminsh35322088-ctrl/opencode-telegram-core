const MAX_OUTPUT_CHARS = 24_000;
const VALID_ACTIONS = ["status", "jobs", "dispatch", "watch", "logs", "verify", "rerun-failed", "cancel"] as const;
type Action = typeof VALID_ACTIONS[number];
type Context = { directory?: string; worktree?: string; process?: { execFile?: (command: string, args: string[], options?: Record<string, unknown>) => Promise<{ stdout: string; stderr?: string }> }; ask?: (value: Record<string, unknown>) => Promise<unknown> };
type ApiResult = { status: number; body: unknown };

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated` : text;
}
function runId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!/^\d{1,20}$/u.test(id)) throw new Error("A numeric GitHub Actions runId is required.");
  return id;
}
function repository(value: unknown): string {
  const repo = String(value ?? "").trim().replace(/\.git$/u, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/u.test(repo)) throw new Error("Pass repo as OWNER/REPOSITORY or ensure the current Topic workspace has a GitHub origin.");
  return repo;
}
function query(values: Record<string, string | undefined>): string {
  const pairs = Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
}
async function request(method: string, route: string, body?: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch("http://127.0.0.1:4102/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path: route, ...(body ? { body: JSON.stringify(body) } : {}) }),
    signal: AbortSignal.timeout(25_000),
  });
  const value = await response.json().catch(() => null) as ApiResult | null;
  if (!response.ok || !value || typeof value.status !== "number") throw new Error("GitHub API capability rejected; verify the Topic's GitHub integration.");
  if (value.status < 200 || value.status >= 300) throw new Error(`GitHub API returned HTTP ${value.status}: ${clip(value.body)}`);
  return value;
}
async function approve(context: Context, action: Action, repo: string, details: Record<string, unknown>): Promise<void> {
  if (typeof context.ask !== "function") throw new Error("GitHub Actions mutation requires the built-in Telegram approval capability.");
  await context.ask({
    permission: "github-actions",
    patterns: [`github-actions:${repo}:${action}`],
    always: [],
    metadata: { input: { action, repository: repo, ...details, grantScope: "This operation only; this Topic's GitHub account" } },
  });
}
async function inferRepository(context: Context): Promise<string> {
  try {
    const result = await context.process?.execFile?.("git", ["config", "--get", "remote.origin.url"], {
      cwd: context.directory || context.worktree || process.cwd(), timeout: 5_000, maxBuffer: 4096,
    });
    const remote = result?.stdout.trim().replace(/\.git$/u, "") ?? "";
    const match = /(?:github\.com[:/])([^/]+\/[^/]+)$/iu.exec(remote);
    if (match?.[1]) return repository(match[1]);
  } catch { /* caller can pass an explicit repository */ }
  throw new Error("Could not infer a GitHub repository from this Topic workspace. Pass repo=OWNER/REPOSITORY.");
}

export default {
  description: "Topic-scoped GitHub Actions controls through the authenticated GitHub API proxy. Inspect runs and jobs, view failed step summaries, dispatch existing workflows, verify run completion, rerun failed jobs, or cancel runs. Every mutating operation requires explicit Telegram approval; no workflow files are created or edited.",
  args: {
    action: { type: "string", enum: [...VALID_ACTIONS] },
    repo: { type: "string" },
    workflow: { type: "string" },
    branch: { type: "string" },
    commit: { type: "string" },
    ref: { type: "string" },
    runId: { type: "string" },
  },
  async execute(args: { action?: string; repo?: string; workflow?: string; branch?: string; commit?: string; ref?: string; runId?: string }, context: Context) {
    const action = args.action as Action;
    if (!VALID_ACTIONS.includes(action)) throw new Error(`action must be one of ${VALID_ACTIONS.join(", ")}.`);
    const repo = args.repo ? repository(args.repo) : await inferRepository(context);
    const prefix = `/repos/${repo}`;
    const workflow = (args.workflow || "CI").trim();
    if (workflow.length > 128 || !/^[A-Za-z0-9_. -]+$/u.test(workflow)) throw new Error("Invalid workflow name or filename.");
    if (action === "dispatch") {
      const ref = (args.ref || "").trim();
      if (!ref || ref.length > 255 || /[\r\n\0]/u.test(ref)) throw new Error("dispatch requires an explicit branch, tag, or commit in ref.");
      const workflowList = (await request("GET", `${prefix}/actions/workflows?per_page=100`)).body as { workflows?: Array<Record<string, unknown>> };
      const match = (workflowList.workflows ?? []).find((item) => item.name === workflow || item.path === workflow || (typeof item.path === "string" && item.path.split("/").at(-1) === workflow));
      if (!match || (typeof match.id !== "number" && typeof match.path !== "string")) throw new Error(`Existing workflow not found: ${workflow}`);
      const workflowRef = typeof match.path === "string" ? match.path.split("/").at(-1)! : String(match.id);
      await approve(context, action, repo, { workflow: workflowRef, ref });
      await request("POST", `${prefix}/actions/workflows/${encodeURIComponent(workflowRef)}/dispatches`, { ref });
      return JSON.stringify({ ok: true, repository: repo, workflow: workflowRef, ref, dispatched: true }, null, 2);
    }
    if (action === "status") {
      const route = `${prefix}/actions/runs${query({ per_page: "10", branch: args.branch?.trim(), head_sha: args.commit?.trim(), status: undefined })}`;
      const body = (await request("GET", route)).body as { workflow_runs?: unknown[]; total_count?: number };
      return clip({ ok: true, repository: repo, total: body.total_count ?? 0, runs: body.workflow_runs ?? [] });
    }
    const id = runId(args.runId);
    if (action === "jobs" || action === "logs") {
      const body = (await request("GET", `${prefix}/actions/runs/${id}/jobs?per_page=100`)).body as { jobs?: Array<Record<string, unknown>>; total_count?: number };
      const jobs = (Array.isArray(body.jobs) ? body.jobs : []).map((job) => ({
        id: job.id, name: job.name, status: job.status, conclusion: job.conclusion,
        started_at: job.started_at, completed_at: job.completed_at, html_url: job.html_url,
        steps: Array.isArray(job.steps) ? job.steps.map((step: Record<string, unknown>) => ({ name: step.name, status: step.status, conclusion: step.conclusion, number: step.number })) : [],
      }));
      if (action === "logs") return clip({ ok: true, runId: id, jobs: jobs.filter((job) => job.conclusion !== "success"), note: "This bounded proxy returns failed job/step diagnostics. Raw archive logs use a temporary redirect and are intentionally not fetched with the GitHub credential." });
      return clip({ ok: true, runId: id, total: body.total_count ?? jobs.length, jobs });
    }
    if (action === "rerun-failed" || action === "cancel") {
      await approve(context, action, repo, { runId: id });
      const suffix = action === "rerun-failed" ? "rerun-failed-jobs" : "cancel";
      await request("POST", `${prefix}/actions/runs/${id}/${suffix}`);
      return JSON.stringify({ ok: true, repository: repo, runId: id, [action === "cancel" ? "cancelled" : "rerun"]: true }, null, 2);
    }
    const body = (await request("GET", `${prefix}/actions/runs/${id}`)).body as Record<string, unknown>;
    const completed = body.status === "completed";
    const succeeded = completed && body.conclusion === "success";
    return clip({ ok: action === "watch" ? succeeded || !completed : succeeded, pending: !completed, verified: succeeded, run: body,
      hint: succeeded ? "CI completed successfully." : completed ? `CI completed with conclusion=${String(body.conclusion ?? "unknown")}.` : "Run is still active; retry with the same runId. A pending run is not a green verification." });
  },
};
