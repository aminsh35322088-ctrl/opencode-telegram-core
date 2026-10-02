import { mock } from "bun:test"
import { once } from "node:events"
import { Process } from "../../src/util/process"
import { telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"

const completed = new Error("headless governor probe completed")
mock.module("../../src/server/server", () => ({
  Server: {
    async listen() {
      const children: Process.Child[] = []
      try {
        for (let i = 0; i < 2; i++) {
          const child = Process.spawn(["/bin/sleep", "60"], {
            env: { OPENCODE_TELEGRAM_PROCESS_KIND: "utility" },
            stdin: "ignore", stdout: "ignore", stderr: "ignore",
          })
          children.push(child)
          await once(child, "spawn")
        }
        let rejected = false
        try {
          children.push(Process.spawn(["/bin/sleep", "60"], {
            env: { OPENCODE_TELEGRAM_PROCESS_KIND: "utility" },
            stdin: "ignore", stdout: "ignore", stderr: "ignore",
          }))
        } catch (error) {
          rejected = error instanceof Error && /process budget/i.test(error.message)
        }
        if (!rejected) throw new Error("standalone headless admitted a third utility process")
        if (telegramProcessBudgetSnapshot().activeCount !== 2) throw new Error("headless processes were not accounted")
      } finally {
        await Promise.all(children.map((child) => Process.stop(child)))
        await Promise.all(children.map((child) => child.exited))
      }
      if (telegramProcessBudgetSnapshot().activeCount !== 0) throw new Error("headless admission leaked after cleanup")
      throw completed
    },
  },
}))

process.argv = [process.execPath, "telegram-headless.ts", "serve", "--port", "0"]
try {
  await import("../../src/telegram-headless")
  throw new Error("headless entrypoint returned without probing server startup")
} catch (error) {
  if (error !== completed) throw error
}
