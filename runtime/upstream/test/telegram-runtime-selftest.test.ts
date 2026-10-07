import { expect, test } from "bun:test";
import { RuntimeSelftest } from "@opencode-ai/core/telegram-runtime-selftest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

function fixture(stall = false, failCleanup = false) {
  const calls: any[] = [];
  const controller = new RuntimeSelftest({
    directory: () => mkdtemp(path.join(os.tmpdir(), "native-selftest-test-")),
    scope: (_execution, _epoch, session, workspace, signal) => ({
      port: {
        execFile: async (
          command: string,
          args: readonly string[],
          options: any,
        ) => {
          calls.push({ command, args, options, session, workspace });
          if (stall)
            await new Promise((_ok, no) =>
              signal.addEventListener("abort", () => no(new Error("aborted")), {
                once: true,
              }),
            );
          return {
            stdout: JSON.stringify({
              version: 1,
              profile: "baseline",
              uid: 1000,
              node: 22,
              toolchain: true,
              pythonVenv: true,
              sqlite: true,
              transfer: true,
              media: true,
              chromium: false,
              ...(args.includes("--online")
                ? {
                    profile: "network",
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
            }),
            stderr: "",
          };
        },
        browser: async (request: any) => {
          calls.push(request);
          if (request.action === "screenshot")
            await writeFile(
              path.join(workspace, request.filename),
              "actual-image",
            );
          return { stdout: "WorkerRuntime", stderr: "" };
        },
      },
      close: async () => {
        calls.push("scope joined");
        if (failCleanup) throw new Error("unconfirmed group");
      },
    }),
    browsers: () =>
      ({
        close: async () => {
          calls.push("browser joined");
        },
      }) as any,
    remove: async (value: string) => {
      calls.push("directory removed");
      await rm(value, { recursive: true, force: true });
    },
  });
  return { controller, calls };
}

test("fixed baseline uses immutable fixture and joins before deleting private owner", async () => {
  const run = fixture();
  const result = await run.controller.start("baseline", "run_fixed");
  expect(result.joined).toBe(true);
  expect(result.runId).toBe("run_fixed");
  expect(result.chromium).toBe(false);
  expect(run.calls[0].command).toBe("python3");
  expect(run.calls[0].args).toEqual([
    "/opt/worker-runtime/worker-runtime-smoke.py",
    "--tools-only",
  ]);
  expect(run.calls[0].options.env.HOME).toBe(run.calls[0].workspace);
  expect(run.calls[0].options.env.TMPDIR).toBe(run.calls[0].workspace);
  expect(run.calls.slice(-3)).toEqual([
    "scope joined",
    "browser joined",
    "directory removed",
  ]);
});

test("browser profile has only fixed data URL and private relative screenshot", async () => {
  const run = fixture();
  const result = await run.controller.start("browser", "run_browser");
  expect(result.chromium).toBe(true);
  expect(result.profile).toBe("browser");
  const browser = run.calls.filter((call) => call?.action);
  expect(browser.map((call) => call.action)).toEqual([
    "open",
    "snapshot",
    "screenshot",
    "close",
  ]);
  expect(browser[0].args).toEqual([
    "data:text/html,<title>WorkerRuntime</title><h1>WorkerRuntime</h1>",
  ]);
  expect(browser[2].filename).toBe("runtime-selftest.png");
});

test("invalid inputs, singleflight and exact tombstoned abort fail closed", async () => {
  const run = fixture(true);
  await expect(run.controller.start("shell" as any, "run")).rejects.toThrow();
  await expect(
    run.controller.start("baseline", "../foreign"),
  ).rejects.toThrow();
  expect(await run.controller.abort("early")).toEqual({
    runId: "early",
    aborted: false,
    joined: true,
  });
  expect((await run.controller.start("baseline", "early")).aborted).toBe(true);
  const active = run.controller.start("baseline", "owned");
  for (let attempt = 0; !run.calls.length && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(run.calls.length).toBe(1);
  await expect(run.controller.start("baseline", "other")).rejects.toThrow(
    "busy",
  );
  expect(await run.controller.abort("owned")).toEqual({
    runId: "owned",
    aborted: true,
    joined: true,
  });
  expect(await active).toMatchObject({
    runId: "owned",
    joined: true,
    success: false,
    aborted: true,
  });
  expect(run.calls.slice(-3)).toEqual([
    "scope joined",
    "browser joined",
    "directory removed",
  ]);
});

test("failed scope join preserves directory and fences replacement while still closing browser", async () => {
  const run = fixture(false, true);
  await expect(run.controller.start("baseline", "failed")).rejects.toThrow(
    "cleanup unconfirmed",
  );
  expect(run.calls).toContain("browser joined");
  expect(run.calls).not.toContain("directory removed");
  await expect(run.controller.start("baseline", "replacement")).rejects.toThrow(
    "busy",
  );
  await expect(run.controller.abort("failed")).rejects.toThrow(
    "cleanup unconfirmed",
  );
  await rm(run.calls[0].workspace, { recursive: true, force: true });
});

test("network profile runs only immutable online fixture and verifies fixed dependency proof", async () => {
  const run = fixture();
  const result = await run.controller.start("network", "run_network");
  expect(result.success).toBe(true);
  expect(result.profile).toBe("network");
  expect(result.externalNetworkOperations).toEqual([
    "npm.install",
    "pip.install",
    "git.clone",
  ]);
  expect(result.externalRequests).toBeUndefined();
  expect(run.calls[0].args).toEqual([
    "/opt/worker-runtime/worker-runtime-smoke.py",
    "--tools-only",
    "--online",
  ]);
  expect(run.calls.filter((call) => call?.action)).toEqual([]);
});


test("tombstone capacity is reserved before work and cannot strand a joined owner", async () => {
  const run = fixture(true);
  const active = run.controller.start("baseline", "reserved");
  for (let attempt = 0; !run.calls.length && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  for (let index = 0; index < 7; index++) await run.controller.abort("other_" + index);
  await expect(run.controller.abort("overflow")).rejects.toThrow("capacity");
  expect(await run.controller.abort("reserved")).toMatchObject({joined: true, aborted: true});
  expect(await active).toMatchObject({joined: true, success: false});
  const count = run.calls.length;
  await expect(run.controller.start("baseline", "next")).rejects.toThrow("capacity");
  expect(run.calls.length).toBe(count);
  expect((await run.controller.start("baseline", "reserved")).aborted).toBe(true);
});


test("expired active reservation survives unrelated abort admission until cleanup joins", async () => {
  const run = fixture(true);
  const active = run.controller.start("baseline", "slow_cleanup");
  for (let attempt = 0; !run.calls.length && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  const realNow = Date.now;
  const later = realNow() + 301000;
  Date.now = () => later;
  try {
    for (let index = 0; index < 7; index++) await run.controller.abort("late_" + index);
    await expect(run.controller.abort("late_overflow")).rejects.toThrow("capacity");
    expect(await run.controller.abort("slow_cleanup")).toMatchObject({joined: true, aborted: true});
    expect(await active).toMatchObject({joined: true, success: false});
  } finally {
    Date.now = realNow;
  }
});
