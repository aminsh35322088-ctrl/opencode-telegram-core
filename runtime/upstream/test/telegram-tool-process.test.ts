import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, realpath, rm, symlink, writeFile, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import { createToolProcessScope } from "@opencode-ai/core/telegram-tool-process"
import { TelegramProcessBudgetGovernor, telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "../../src/tool/registry"
import { Agent } from "../../src/agent/agent"
import { Plugin } from "../../src/plugin"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { SessionID, MessageID } from "../../src/session/schema"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const plugin = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    init: () => Effect.void,
    trigger: ((_name: unknown, _input: unknown, output: unknown) =>
      Effect.succeed(output)) as Plugin.Interface["trigger"],
    list: () =>
      Effect.succeed([
        {
          tool: {
            process_probe: {
              description: "Inspect the runtime process capability",
              args: {},
              execute: async (_args: unknown, context: unknown) => {
                const port = (context as { process?: { execFile?: unknown } }).process
                return typeof port?.execFile
              },
            },
          },
        },
      ]),
  }),
)

const it = testEffect(
  LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node]), [
    [Config.node, TestConfig.layer({ directories: () => Effect.succeed([]) })],
    [Plugin.node, plugin],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ]),
)

it.instance("custom tools receive the Core process capability from the captured runtime context", () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const agents = yield* Agent.Service
    const tool = (yield* registry.all()).find((item) => item.id === "process_probe")
    if (!tool) throw new Error("probe tool was not loaded")
    const result = yield* tool.execute(
      {},
      {
        sessionID: SessionID.make("ses_process_probe"),
        messageID: MessageID.make("msg_process_probe"),
        agent: (yield* agents.defaultInfo()).name,
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      },
    )
    expect(result.output).toBe("function")
  }),
)

const directories: string[] = []
const budgetFlag = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
beforeEach(() => {
  process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1"
})
afterEach(async () => {
  if (budgetFlag === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = budgetFlag
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function owned() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "core-tool-process-")))
  directories.push(directory)
  const control = new SessionExecutionControl()
  const execution = control.start({ sessionId: "session", runId: "run", directory })
  const cancellation = new AbortController()
  const scope = createToolProcessScope(execution, execution.epoch, "session", directory, cancellation.signal)
  return { directory, control, execution, cancellation, scope }
}

test("a retired custom-tool capability cannot admit work into its replacement", async () => {
  const run = await owned()
  run.control.close(run.execution.owner)
  run.control.start({ ...run.execution.owner, runId: "replacement" })
  await expect(run.scope.port.execFile("unused", [])).rejects.toThrow("execution owner retired")
  await run.scope.close()
})

test("custom processes reject a foreign session or workspace before spawning", async () => {
  const run = await owned()
  for (const [session, directory] of [
    ["foreign", run.directory],
    ["session", path.dirname(run.directory)],
  ]) {
    const scope = createToolProcessScope(
      run.execution,
      run.execution.epoch,
      session!,
      directory!,
      run.cancellation.signal,
    )
    await expect(scope.port.execFile("unused", [])).rejects.toThrow("owner mismatch")
    await scope.close()
  }
  await run.scope.close()
})

test("closed tool invocations reject late callbacks while their runtime run remains live", async () => {
  const run = await owned()
  await run.scope.close()
  await expect(run.scope.port.execFile("unused", [])).rejects.toThrow("tool invocation closed")
  expect(run.execution.signal.aborted).toBe(false)
})

test("tool cancellation wakes a process admission blocked by pause without retiring its Topic", async () => {
  const run = await owned()
  run.control.pause(run.execution.owner)
  const pending = run.scope.port.execFile("unused", [])
  run.cancellation.abort(new Error("tool cancelled"))
  await expect(pending).rejects.toThrow("tool cancelled")
  await run.scope.close()
  expect(run.execution.signal.aborted).toBe(false)
})

test("custom processes reject canonical workspace escapes", async () => {
  const run = await owned()
  await expect(run.scope.port.execFile("unused", [], { cwd: ".." })).rejects.toThrow("workspace escape")
  await run.scope.close()
})

test("pause during asynchronous workspace validation blocks process admission", async () => {
  const run = await owned()
  let settled = false
  const pending = run.scope.port.execFile("unused", []).finally(() => { settled = true }).catch(() => undefined)
  run.control.pause(run.execution.owner)
  await Bun.sleep(30)
  const settledWhilePaused = settled
  await run.scope.close()
  await pending
  expect(settledWhilePaused).toBe(false)
})

test("owned process-group accounting stays reserved after leader exit until explicit cleanup release", () => {
  const governor = new TelegramProcessBudgetGovernor(1, () => ({ memoryUsedBytes: 0, memoryLimitBytes: null, memoryPressure: null }), () => true, () => false)
  const lease = governor.acquire("node")!
  lease.bindPid(1234, true)
  expect(governor.snapshot().activeCount).toBe(1)
  expect(() => governor.acquire("node")).toThrow("process budget rejected")
  lease.release()
  expect(governor.snapshot().activeCount).toBe(0)
})

test.skipIf(process.platform === "win32")("symlink workspaces cannot bypass custom process ownership", async () => {
  const run = await owned()
  const other = await owned()
  await symlink(other.directory, path.join(run.directory, "escape"), "dir")
  await expect(run.scope.port.execFile("unused", [], { cwd: "escape" })).rejects.toThrow("workspace escape")
  await run.scope.close()
  await other.scope.close()
})

test.skipIf(process.platform !== "win32")("unsupported process-group platforms fail closed", async () => {
  const run = await owned()
  await expect(run.scope.port.execFile("unused", [])).rejects.toThrow("unsupported on Windows")
  await run.scope.close()
})

const linux = test.skipIf(process.platform !== "linux")
linux("custom process success and failure preserve bounded output and release governor admission", async () => {
  const run = await owned()
  const count = telegramProcessBudgetSnapshot().activeCount
  expect(
    await run.scope.port.execFile(process.execPath, ["-e", "process.stdout.write('out');process.stderr.write('err')"]),
  ).toEqual({ stdout: "out", stderr: "err" })
  const error = await run.scope.port
    .execFile(process.execPath, ["-e", "process.stdout.write('partial');process.exit(7)"])
    .catch((error: unknown) => error)
  expect(error).toMatchObject({ code: 7, stdout: "partial" })
  await run.scope.close()
  expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
})

linux("custom process output pressure terminates the group and releases its lease", async () => {
  const run = await owned()
  const count = telegramProcessBudgetSnapshot().activeCount
  await expect(
    run.scope.port.execFile(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(100000));setInterval(()=>{},1000)"],
      { maxBuffer: 100 },
    ),
  ).rejects.toMatchObject({ code: "OUTPUT_LIMIT" })
  await run.scope.close()
  expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
})

linux("pause suspends the existing process and active timeout; resume continues its original PID", async () => {
  const run = await owned()
  const marker = path.join(run.directory, "ticks")
  await writeFile(marker, "0")
  const pending = run.scope.port.execFile(
    process.execPath,
    [
      "-e",
      "const fs=require('fs');let i=0;const timer=setInterval(()=>{fs.writeFileSync('ticks',String(++i));if(i===8){clearInterval(timer);process.stdout.write(String(process.pid))}},30)",
    ],
    { timeout: 500 },
  )
  await waitFor(async () => Number(await readFile(marker, "utf8")) >= 2)
  run.control.pause(run.execution.owner)
  await Bun.sleep(60)
  const paused = await readFile(marker, "utf8")
  await Bun.sleep(600)
  expect(await readFile(marker, "utf8")).toBe(paused)
  run.control.resume(run.execution.owner)
  expect(Number((await pending).stdout)).toBeGreaterThan(0)
  await run.scope.close()
})

linux("abort after pause terminates owned descendants that ignore TERM", async () => {
  const run = await owned()
  const marker = path.join(run.directory, "ready")
  const script =
    "const cp=require('child_process'),fs=require('fs');const child=cp.spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'inherit'});fs.writeFileSync('ready',JSON.stringify([process.pid,child.pid]));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"
  const pending = run.scope.port.execFile(process.execPath, ["-e", script]).then(
    () => false,
    () => true,
  )
  await waitFor(async () => {
    try {
      return JSON.parse(await readFile(marker, "utf8")).length === 2
    } catch {
      return false
    }
  })
  const pids: number[] = JSON.parse(await readFile(marker, "utf8"))
  run.control.pause(run.execution.owner)
  run.control.close(run.execution.owner)
  expect(await pending).toBe(true)
  await run.scope.close()
  for (const pid of pids) expect(alive(pid)).toBe(false)
})

linux("returning from a tool closes detached processes and prevents late process starts", async () => {
  const run = await owned()
  const marker = path.join(run.directory, "ready")
  const pending = run.scope.port
    .execFile(process.execPath, [
      "-e",
      "require('fs').writeFileSync('ready',String(process.pid));setInterval(()=>{},1000)",
    ])
    .catch(() => undefined)
  await waitFor(async () => {
    try {
      return Number(await readFile(marker, "utf8")) > 0
    } catch {
      return false
    }
  })
  const pid = Number(await readFile(marker, "utf8"))
  await run.scope.close()
  await pending
  expect(alive(pid)).toBe(false)
  await expect(run.scope.port.execFile("unused", [])).rejects.toThrow("tool invocation closed")
})

linux("successful custom tools retire setsid and double-fork descendants before releasing admission", async () => {
  const run = await owned()
  const count = telegramProcessBudgetSnapshot().activeCount
  const script = [
    "import os,time,pathlib",
    "root=pathlib.Path('.')",
    "if os.fork()==0:",
    " os.setsid()",
    " if os.fork()!=0: os._exit(0)",
    " for fd in (0,1,2): os.dup2(os.open('/dev/null',os.O_RDWR),fd)",
    " root.joinpath('daemon').write_text(str(os.getpid()))",
    " while True: time.sleep(1)",
    "while not root.joinpath('daemon').exists(): time.sleep(.001)",
    "print('leader complete')",
  ].join("\n")
  const result = await run.scope.port.execFile("python3", ["-c", script])
  const pid = Number(await readFile(path.join(run.directory, "daemon"), "utf8"))
  try {
    expect(result.stdout.trim()).toBe("leader complete")
    expect(alive(pid)).toBe(false)
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
    await run.scope.close()
  } finally {
    if (alive(pid)) process.kill(pid, "SIGKILL")
  }
})

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(read: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + 3_000
  while (!(await read())) {
    if (Date.now() > end) throw new Error("process readiness timed out")
    await Bun.sleep(10)
  }
}
