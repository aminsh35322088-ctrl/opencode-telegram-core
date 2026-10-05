import { type spawn } from "node:child_process"
import { realpath } from "node:fs/promises"
import path from "node:path"
import type { ToolProcessPort } from "./telegram-tool-process-contract"
import type { SessionExecutionLease } from "./session-execution-control"
import { acquireTelegramProcessBudget, isTelegramProcessBudgetEnabled } from "./telegram-process-budget"
import { withDeadline } from "./telegram-deadline"
import { spawnProcessTree, processTree } from "./telegram-process-tree"
import type { WorkspaceBrowsers } from "./telegram-browser-process"

export class ToolProcessError extends Error {
  constructor(
    message: string,
    readonly code: string | number,
    readonly stdout = "",
    readonly stderr = "",
  ) {
    super(message)
    this.name = "ToolProcessError"
  }
}

// The caller supplies only the captured runtime context, never a tool-selected
// owner. Resource accounting remains in the existing process governor.
export function createToolProcessScope(
  execution: SessionExecutionLease | undefined,
  epoch: number | undefined,
  sessionId: string,
  directory: string,
  signal: AbortSignal,
  browsers?: WorkspaceBrowsers,
) {
  const invocation = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closedInvocation = false
  let cleanupFailure: unknown
  const execFile = async (command: string, args: readonly string[],
    options: NonNullable<Parameters<ToolProcessPort["execFile"]>[2]> = {}) => {
    if (closedInvocation) throw new Error("tool invocation closed")
    if (!execution || epoch === undefined) throw new Error("custom process requires a live runtime execution")
    execution.assertOwned(epoch)
    if (execution.owner.sessionId !== sessionId || execution.owner.directory !== directory)
      throw new Error("custom process execution owner mismatch")
    const cancellation = AbortSignal.any([
      signal,
      execution.signal,
      invocation.signal,
      ...(options.signal ? [options.signal] : []),
    ])
    await execution.checkpoint(cancellation, epoch)
    const root = await realpath(directory)
    const cwd = await realpath(path.resolve(root, options.cwd ?? root))
    const relative = path.relative(root, cwd)
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
      throw new Error("custom process workspace escape")
    await execution.checkpoint(cancellation, epoch)
    execution.assertOwned(epoch)
    cancellation.throwIfAborted()
    if (process.platform === "win32") throw new Error("custom process group lifecycle is unsupported on Windows")
    if (!isTelegramProcessBudgetEnabled()) throw new Error("custom process budget is not enabled")
    const timeout = options.timeout ?? 30_000
    const maxBuffer = options.maxBuffer ?? 1024 * 1024
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600_000)
      throw new Error("custom process timeout must be between 1 and 600000 milliseconds")
    if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1 || maxBuffer > 16 * 1024 * 1024)
      throw new Error("custom process output limit must be between 1 and 16777216 bytes")
    const env = { ...process.env, ...options.env }
    // A tool's environment cannot override admission category or disable
    // governance for descendants using the Core spawn paths.
    env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1"
    delete env.OPENCODE_TELEGRAM_PROCESS_KIND
    const budget = acquireTelegramProcessBudget(command, env)
    if (!budget) throw new Error("custom process budget admission unavailable")
    let detach: (() => void) | undefined
    let child: ReturnType<typeof spawn> | undefined
    let closed = Promise.resolve()
    let output = { stdout: "", stderr: "" }
    try {
      child = spawnProcessTree(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
      budget.bindPid(child.pid, true)
      const proc = child
      const terminate = () => processTree(proc)!.signal("SIGKILL")
      let close!: () => void
      closed = new Promise<void>((resolve) => {
        close = resolve
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let bytes = 0
      let failure: unknown
      const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        proc.once("error", (error) => {
          failure ??= error
        })
        proc.once("close", (code, stopped) => {
          close()
          resolve({ code, signal: stopped })
        })
      })
      const collect = (target: Buffer[], chunk: Buffer) => {
        const available = Math.max(0, maxBuffer - bytes)
        bytes += chunk.length
        if (available) target.push(chunk.subarray(0, available))
        if (bytes <= maxBuffer || failure) return
        failure = new ToolProcessError("custom process output limit exceeded", "OUTPUT_LIMIT")
        try {
          terminate()
        } catch (error) {
          execution.fail(error)
        }
      }
      proc.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk))
      proc.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk))
      detach = execution.attach({
        pause: () => processTree(proc)!.signal("SIGSTOP"),
        resume: () => processTree(proc)!.signal("SIGCONT"),
        terminate,
      })
      const exit = await withDeadline(() => result, {
        timeoutMs: timeout,
        label: "custom tool process",
        parentSignal: cancellation,
        activity: execution,
      })
      if (failure) throw failure
      output = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") }
      if (exit.code !== 0)
        throw new ToolProcessError(
          "custom process exited unsuccessfully",
          exit.code ?? "SIGNAL",
          output.stdout,
          output.stderr,
        )
    } finally {
      try {
        if (child) {
          await withDeadline(
            async () => {
              await processTree(child!)!.cleanup()
              await closed
            },
            { timeoutMs: 5_000, label: "custom process tree cleanup" },
          )
        }
        detach?.()
        budget.release()
      } catch (error) {
        // Keep accounting and workspace authority fenced if death cannot be
        // confirmed. A replacement must never overlap unfinished cleanup.
        execution.fail(error)
        cleanupFailure = error
        throw error
      }
    }
    // Release the confirmed-dead group's PID and accounting before a paused
    // result can wait. A later resume must never signal a reused OS identity.
    await execution.checkpoint(cancellation, epoch)
    return output
  }
  const port: ToolProcessPort = Object.freeze({
    browser: (request: Parameters<ToolProcessPort["browser"]>[0]) => {
      if (closedInvocation) return Promise.reject(new Error("tool invocation closed"))
      if (!execution || epoch === undefined || !browsers)
        return Promise.reject(new Error("persistent browser requires captured workspace and execution authority"))
      const operation = browsers.execute(execution, epoch, sessionId, request,
        AbortSignal.any([signal, invocation.signal]))
      pending.add(operation)
      void operation.then(() => pending.delete(operation), () => pending.delete(operation))
      return operation
    },
    execFile: (...args: Parameters<ToolProcessPort["execFile"]>) => {
      const operation = execFile(...args)
      pending.add(operation)
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      )
      return operation
    },
  })
  return {
    port,
    close: async () => {
      closedInvocation = true
      invocation.abort(new Error("tool invocation closed"))
      await withDeadline(() => Promise.allSettled([...pending]), {
        timeoutMs: 10_000,
        label: "custom tool process cleanup",
      })
      if (cleanupFailure) throw cleanupFailure
    },
  }
}
