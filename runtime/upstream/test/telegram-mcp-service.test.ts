import { beforeEach, afterEach, expect, spyOn } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"
import { StdioClientTransport } from "../../src/mcp/telegram-stdio"
import { MCP } from "../../src/mcp/index"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const flag = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
beforeEach(() => { process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1" })
afterEach(() => {
  if (flag === undefined) delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET
  else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = flag
})
const it = testEffect(LayerNode.compile(MCP.node))
it.instance("MCP disconnect joins server descendant cleanup before returning admission", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const dir = (yield* TestInstance).directory
  const pidFile = path.join(dir, "mcp-child.pid")
  const mcp = yield* MCP.Service
  const count = telegramProcessBudgetSnapshot().activeCount
  yield* mcp.add("owned-server", {
    type: "local", command: [process.execPath, path.join(import.meta.dir, "telegram-mcp-service.fixture.ts")],
    environment: { MCP_TEST_CHILD_PID: pidFile }, timeout: 5000,
  })
  const pid = Number(yield* Effect.promise(() => readFile(pidFile, "utf8")))
  yield* Effect.gen(function* () {
    expect(pid).toBeGreaterThan(0)
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count + 1)
    yield* mcp.disconnect("owned-server")
    const alive = yield* Effect.promise(async () => {
      try { await readFile(`/proc/${pid}/stat`); return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
    })
    expect(alive).toBe(false)
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
  }).pipe(Effect.ensuring(Effect.sync(() => {
    try { process.kill(pid, "SIGKILL") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  })))
}))

it.instance("failed MCP disconnect retains its quarantined workspace owner", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const dir = (yield* TestInstance).directory
  const mcp = yield* MCP.Service
  const count = telegramProcessBudgetSnapshot().activeCount
  yield* mcp.add("uncertain-server", {
    type: "local", command: [process.execPath, path.join(import.meta.dir, "telegram-mcp-service.fixture.ts")],
    environment: { MCP_TEST_CHILD_PID: path.join(dir, "uncertain.pid") }, timeout: 5000,
  })
  const client = (yield* mcp.clients())["uncertain-server"]!
  const original = StdioClientTransport.prototype.close
  let held: StdioClientTransport | undefined
  const observer = spyOn(StdioClientTransport.prototype, "close").mockImplementation(function(this: StdioClientTransport) {
    held = this
    return Promise.reject(new Error("cleanup uncertain"))
  })
  yield* Effect.gen(function* () {
    const result = yield* mcp.disconnect("uncertain-server").pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    expect((yield* mcp.clients())["uncertain-server"]).toBe(client)
    expect((yield* mcp.status())["uncertain-server"]?.status).toBe("failed")
    expect(telegramProcessBudgetSnapshot().activeCount).toBe(count + 1)
  }).pipe(Effect.ensuring(Effect.promise(async () => {
    observer.mockRestore()
    if (held) await original.call(held)
  })))
  expect(telegramProcessBudgetSnapshot().activeCount).toBe(count)
}))

it.instance("failed MCP transport quarantines tools while retaining its service owner", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const dir = (yield* TestInstance).directory
  const mcp = yield* MCP.Service
  yield* mcp.add("failed-transport", {
    type: "local", command: [process.execPath, path.join(import.meta.dir, "telegram-mcp-service.fixture.ts")],
    environment: { MCP_TEST_CHILD_PID: path.join(dir, "failed.pid") }, timeout: 5000,
  })
  const client = (yield* mcp.clients())["failed-transport"]!
  expect(Object.keys(yield* mcp.tools())).toContain("failed-transport_probe")
  yield* Effect.sync(() => client.onerror?.(new Error("service cleanup failed")))
  expect((yield* mcp.clients())["failed-transport"]).toBe(client)
  expect((yield* mcp.status())["failed-transport"]?.status).toBe("failed")
  expect(Object.keys(yield* mcp.tools())).not.toContain("failed-transport_probe")
  yield* mcp.disconnect("failed-transport")
}))
