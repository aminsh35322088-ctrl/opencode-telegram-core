import type { ChildProcess } from "node:child_process"
import type { TelegramProcessLease } from "./telegram-process-budget"
import { abortableSleep, withDeadline } from "./telegram-deadline"

/** Workspace service ownership survives leader exit until terminal/group cleanup. */
export function ownServiceProcess(proc: ChildProcess, budget: TelegramProcessLease | null) {
  const pid = proc.pid
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) throw new Error("service process has no OS identity")
  let retired = false
  let spawned = false
  let cleanup: Promise<void> | undefined
  const started = new Promise<void>((resolve) => {
    proc.once("spawn", () => { spawned = true; budget?.bindPid(pid, true); resolve() })
    proc.once("error", () => resolve())
  })
  const closed = new Promise<void>((resolve) => proc.once("close", () => resolve()))
  const signal = (value: NodeJS.Signals | 0) => {
    if (retired) return false
    try { process.kill(-pid, value); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      retired = true
      return false
    }
  }
  return {
    cleanup: () => cleanup ??= withDeadline(async (abort) => {
      await started
      if (spawned) signal("SIGKILL")
      await closed
      if (spawned) while (signal(0)) await abortableSleep(20, abort)
      retired = true
      budget?.release()
    }, { timeoutMs: 5_000, label: "workspace service process group cleanup" }),
  }
}
