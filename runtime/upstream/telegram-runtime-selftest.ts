/** Worker-private, fixed runtime canary. It creates no persisted Session or provider request. */
import { mkdtemp, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  SessionExecutionControl,
  type SessionExecutionLease,
} from "./session-execution-control";
import { createToolProcessScope } from "./telegram-tool-process";
import { WorkspaceBrowsers } from "./telegram-browser-process";
import type { ToolProcessPort } from "./telegram-tool-process-contract";

type Profile = "baseline" | "browser" | "network";
type Scope = { port: ToolProcessPort; close(): Promise<void> };
type Dependencies = {
  directory(): Promise<string>;
  remove(directory: string): Promise<void>;
  browsers(
    directory: string,
    active: () => void,
  ): Pick<WorkspaceBrowsers, "close">;
  scope(
    execution: SessionExecutionLease,
    epoch: number,
    session: string,
    directory: string,
    signal: AbortSignal,
    browsers: Pick<WorkspaceBrowsers, "close">,
  ): Scope;
};
const defaults: Dependencies = {
  directory: () => mkdtemp(path.join(os.tmpdir(), "oc-runtime-selftest-")),
  remove: (directory) => rm(directory, { recursive: true, force: true }),
  browsers: (directory, active) => new WorkspaceBrowsers(directory, active),
  scope: (execution, epoch, session, directory, signal, browsers) =>
    createToolProcessScope(
      execution,
      epoch,
      session,
      directory,
      signal,
      browsers as WorkspaceBrowsers,
    ),
};
const validRun = (runId: string) =>
  typeof runId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(runId);
const failure = (profile: Profile, runId: string, aborted: boolean) => ({
  version: 1 as const,
  runId,
  profile,
  joined: true as const,
  success: false,
  aborted,
  error: "runtime selftest failed",
});

export class RuntimeSelftest {
  #active?: {
    runId: string;
    controller: AbortController;
    done: Promise<Record<string, unknown>>;
    joined: boolean;
  };
  #cancelled = new Map<string, number>();
  constructor(private readonly dependencies: Dependencies = defaults) {}
  #remember(runId: string) {
    const now = Date.now();
    for (const [id, expires] of this.#cancelled)
      if (expires <= now && id !== this.#active?.runId) this.#cancelled.delete(id);
    if (!this.#cancelled.has(runId) && this.#cancelled.size >= 8)
      throw new Error("runtime selftest cancellation capacity exceeded");
    this.#cancelled.set(runId, now + 300000);
  }
  async start(profile: Profile, runId: string) {
    if (
      !["baseline", "browser", "network"].includes(profile) ||
      !validRun(runId)
    )
      throw new Error("invalid fixed runtime selftest");
    if (this.#cancelled.has(runId)) return failure(profile, runId, true);
    if (this.#active) throw new Error("runtime selftest busy");
    // Reserve replay protection before allocating resources; cleanup cannot overflow.
    this.#remember(runId);
    const controller = new AbortController();
    const active = {
      runId,
      controller,
      done: Promise.resolve({}) as Promise<Record<string, unknown>>,
      joined: false,
    };
    this.#active = active;
    const work = async () => {
      const control = new SessionExecutionControl();
      let directory: string | undefined,
        browsers: Pick<WorkspaceBrowsers, "close"> | undefined,
        scope: Scope | undefined,
        execution: SessionExecutionLease | undefined;
      let proof: Record<string, unknown> | undefined,
        error: unknown,
        aborted = false;
      const timer = setTimeout(
        () => controller.abort(new Error("runtime selftest deadline exceeded")),
        180000,
      );
      try {
        directory = await this.dependencies.directory();
        controller.signal.throwIfAborted();
        const session = "ses_selftest_" + runId;
        execution = control.start({ sessionId: session, runId, directory });
        const owned = execution;
        browsers = this.dependencies.browsers(directory, () => {
          controller.signal.throwIfAborted();
          owned.assertOwned(owned.epoch);
        });
        scope = this.dependencies.scope(
          execution,
          execution.epoch,
          session,
          directory,
          controller.signal,
          browsers,
        );
        const output = await scope.port.execFile(
          "python3",
          [
            "/opt/worker-runtime/worker-runtime-smoke.py",
            "--tools-only",
            ...(profile === "network" ? ["--online"] : []),
          ],
          {
            timeout: 90000,
            maxBuffer: 65536,
            env: {
              HOME: directory,
              TMPDIR: directory,
              XDG_CACHE_HOME: directory,
              XDG_CONFIG_HOME: directory,
              XDG_DATA_HOME: directory,
              XDG_STATE_HOME: directory,
            },
          },
        );
        const parsed = JSON.parse(output.stdout);
        const expected = {
          version: 1,
          profile: profile === "network" ? "network" : "baseline",
          uid: 1000,
          node: 22,
          toolchain: true,
          pythonVenv: true,
          sqlite: true,
          transfer: true,
          media: true,
          chromium: false,
          ...(profile === "network"
            ? {
                externalNetworkOperations: [
                  "npm.install",
                  "pip.install",
                  "git.clone",
                ],
                npmDependency: "is-number@7.0.0",
                pipDependency: "six==1.17.0",
                publicClone: "https://github.com/octocat/Hello-World.git",
              }
            : { externalRequests: 0 }),
        };
        if (
          !parsed ||
          Object.keys(parsed).length !== Object.keys(expected).length ||
          Object.entries(expected).some(
            ([key, value]) =>
              JSON.stringify(parsed[key]) !== JSON.stringify(value),
          )
        )
          throw new Error("runtime selftest proof mismatch");
        proof = { ...expected };
        if (profile === "browser") {
          await scope.port.browser({
            action: "open",
            args: [
              "data:text/html,<title>WorkerRuntime</title><h1>WorkerRuntime</h1>",
            ],
            timeout: 90000,
            maxBuffer: 65536,
          });
          const snapshot = await scope.port.browser({
            action: "snapshot",
            timeout: 90000,
            maxBuffer: 65536,
          });
          if (!snapshot.stdout.includes("WorkerRuntime"))
            throw new Error("runtime selftest browser proof mismatch");
          await scope.port.browser({
            action: "screenshot",
            filename: "runtime-selftest.png",
            timeout: 90000,
            maxBuffer: 65536,
          });
          const screenshot = await stat(
            path.join(directory, "runtime-selftest.png"),
          );
          if (!screenshot.isFile() || screenshot.size === 0)
            throw new Error("runtime selftest screenshot proof mismatch");
          await scope.port.browser({
            action: "close",
            timeout: 30000,
            maxBuffer: 65536,
          });
          proof.chromium = true;
        }
      } catch (cause) {
        error = cause;
        aborted = controller.signal.aborted;
      } finally {
        clearTimeout(timer);
        controller.abort(new Error("runtime selftest joined cleanup"));
        if (execution) control.close(execution.owner);
        // Preserve the authority directory and busy fence when death cannot be proved.
        const joined = await Promise.allSettled([
          scope?.close(),
          browsers?.close(),
        ]);
        if (joined.some((result) => result.status === "rejected"))
          throw new Error("runtime selftest cleanup unconfirmed");
        if (directory) await this.dependencies.remove(directory);
        active.joined = true;
        this.#remember(runId);
        if (this.#active === active) this.#active = undefined;
      }
      if (error) return failure(profile, runId, aborted);
      return {
        ...proof,
        version: 1 as const,
        runId,
        profile,
        joined: true as const,
        success: true,
      };
    };
    active.done = work();
    void active.done.catch(() => {});
    return await active.done;
  }
  async abort(runId: string) {
    if (!validRun(runId)) throw new Error("invalid runtime selftest owner");
    this.#remember(runId);
    const active = this.#active;
    if (!active || active.runId !== runId)
      return { runId, aborted: false, joined: true as const };
    active.controller.abort(new Error("runtime selftest aborted"));
    try {
      await active.done;
    } catch {
      if (!active.joined)
        throw new Error("runtime selftest cleanup unconfirmed");
    }
    if (!active.joined) throw new Error("runtime selftest cleanup unconfirmed");
    return { runId, aborted: true, joined: true as const };
  }
}
