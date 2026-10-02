import { beforeEach, afterEach, expect } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"
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
