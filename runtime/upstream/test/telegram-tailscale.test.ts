import { expect, test } from "bun:test"
import { createToolProcessScope } from "@opencode-ai/core/telegram-tool-process"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"

test("network authority requires captured live Core execution", async () => {
  const scope = createToolProcessScope(undefined, undefined, "session", "/tmp", new AbortController().signal)
  expect(typeof (scope.port as any).network).toBe("function")
  await expect((scope.port as any).network({action:"status"})).rejects.toThrow("live runtime execution")
  await scope.close()
})

test("network authority rejects foreign workspace before delegated execution", async () => {
  const execution = new SessionExecutionControl().start({sessionId:"session",runId:"run",directory:"/tmp/foreign"})
  const scope = createToolProcessScope(execution,execution.epoch,"session","/tmp",new AbortController().signal)
  expect(typeof (scope.port as any).network).toBe("function")
  await expect((scope.port as any).network({action:"status"})).rejects.toThrow("owner mismatch")
  await scope.close()
})
