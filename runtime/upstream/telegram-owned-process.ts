import type { ChildProcess } from "node:child_process"
import type { SessionExecutionLease } from "./session-execution-control"
import type { TelegramProcessLease } from "./telegram-process-budget"
import { abortableSleep, withDeadline } from "./telegram-deadline"

/** A short-lived shell group belongs to its original execution, not its leader's exit. */
export function ownShellProcess(proc: ChildProcess, execution: SessionExecutionLease, epoch: number, budget: TelegramProcessLease) {
  const pid = proc.pid
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) throw new Error("shell process has no OS identity")
  let retired = false
  let detach: (() => void) | undefined
  let complete!: () => void
  const closed = new Promise<void>((resolve) => { complete = resolve })
  let cleanup: Promise<void> | undefined
  const send = (signal: NodeJS.Signals) => {
    if (retired) return
    try { process.kill(-pid, signal) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      // No later pause/resume/abort may target a recycled identity.
      retired = true
      detach?.()
    }
  }
  const alive = () => {
    if (retired) return false
    try { process.kill(-pid, 0); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      retired = true
      return false
    }
  }
  return {
    signal: send,
    attach: () => {
      execution.assertOwned(epoch)
      detach = execution.attach({
        pause: () => send("SIGSTOP"),
        resume: () => send("SIGCONT"),
        terminate: () => send("SIGKILL"),
      })
      if (retired) detach()
    },
    closed: () => { complete() },
    cleanup: () => cleanup ??= withDeadline(async (signal) => {
      // Also terminate descendants that closed their pipes before leader exit.
      send("SIGKILL")
      await closed
      while (alive()) await abortableSleep(20, signal)
      retired = true
      detach?.()
      budget.release()
    }, { timeoutMs: 5_000, label: "owned shell process group cleanup" }).catch((error) => {
      execution.fail(error)
      // Keep governor admission and execution fenced if death is uncertain.
      throw error
    }),
  }
}
