import { closeSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { acquireTelegramProcessBudget, isTelegramProcessBudgetEnabled } from "./telegram-process-budget"
import type { SessionExecutionLease } from "./session-execution-control"

export interface NetworkRequest {
  readonly action: "connect" | "status" | "devices" | "ssh" | "disconnect" | "logout"
  readonly target?: string
  readonly user?: string
  readonly command?: string
}

// Read and close before custom tools load. Neither the descriptor nor token is
// inherited by model-created children, serialized in config, or placed in env.
const delegated = (() => {
  const value = process.env.CORE_DELEGATED_FD
  delete process.env.CORE_DELEGATED_FD
  if (value === undefined) return undefined
  const fd = Number(value)
  if (!Number.isSafeInteger(fd) || fd < 3) throw new Error("invalid delegated descriptor")
  try {
    const raw = readFileSync(fd, "utf8")
    if (raw.length > 1024) throw new Error("delegated descriptor exceeds bound")
    const data = JSON.parse(raw)
    if (!/^[a-f0-9]{64}$/.test(data.token) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(data.endpoint))
      throw new Error("invalid delegated endpoint")
    return Object.freeze({token:data.token as string,endpoint:data.endpoint as string})
  } finally { closeSync(fd) }
})()

export async function executeTailscale(
  execution: SessionExecutionLease | undefined, epoch: number | undefined,
  sessionId: string, directory: string, signal: AbortSignal, request: NetworkRequest,
): Promise<Record<string, unknown>> {
  if (!execution || epoch === undefined) throw new Error("network requires a live runtime execution")
  execution.assertOwned(epoch)
  if (execution.owner.sessionId !== sessionId || execution.owner.directory !== directory)
    throw new Error("network execution owner mismatch")
  if (!delegated) throw new Error("protected network delegation is unavailable")
  if (!isTelegramProcessBudgetEnabled()) throw new Error("network process budget is disabled")
  if (!["connect", "status", "devices", "ssh", "disconnect", "logout"].includes(request.action))
    throw new Error("unsupported network action")
  const controller = new AbortController()
  const cancellation = AbortSignal.any([signal, execution.signal, controller.signal, AbortSignal.timeout(90_000)])
  await execution.checkpoint(cancellation, epoch)
  const id = randomUUID()
  const payload = { ...request, id, sessionId, directory }
  const rpc = async (action: string, value: object, aborted?: AbortSignal) => {
    const response = await fetch(delegated.endpoint + action, {
      method:"POST",headers:{"Content-Type":"application/json","x-core-admission":delegated.token},
      body:JSON.stringify(value),signal:aborted ?? AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error("protected network operation rejected")
    return response
  }
  let daemon: ReturnType<typeof acquireTelegramProcessBudget> = null
  let command: ReturnType<typeof acquireTelegramProcessBudget> = null
  let detach: (() => void) | undefined
  let attempted = false
  try {
    daemon = acquireTelegramProcessBudget("tailscaled", process.env, "helper")
    command = acquireTelegramProcessBudget("tailscale", process.env, "utility")
    if (!daemon || !command) throw new Error("network budget admission unavailable")
    detach = execution.attach({
      // Pause retires this invocation's scopes. Resume can retry using persisted
      // node identity; no network traffic is retained while the Topic sleeps.
      pause: () => controller.abort(new Error("network operation paused")),
      resume: () => {}, terminate: () => controller.abort(new Error("network operation retired")),
    })
    cancellation.throwIfAborted()
    execution.assertOwned(epoch)
    attempted = true
    const started = await (await rpc("/start",payload,cancellation)).json() as {ok:boolean;result:{pid:number}}
    if (!started.ok || !Number.isSafeInteger(started.result?.pid)) throw new Error("network daemon admission failed")
    daemon.bindPid(started.result.pid, true)
    const response = await rpc("/execute",{id},cancellation)
    if (!response.body) throw new Error("network command receipts unavailable")
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = "", result: Record<string, unknown> | undefined, bytes = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.length
      if (bytes > 2*1024*1024) throw new Error("network output exceeds bound")
      buffered += decoder.decode(chunk.value,{stream:true})
      for (;;) {
        const newline = buffered.indexOf("\n")
        if (newline < 0) break
        const event = JSON.parse(buffered.slice(0,newline))
        buffered = buffered.slice(newline+1)
        if (event.pid !== undefined) {
          if (!Number.isSafeInteger(event.pid) || event.pid < 1) throw new Error("invalid network process identity")
          command.bindPid(event.pid, true)
        } else {
          if (event.ok !== true || !event.result || typeof event.result !== "object")
            throw new Error("protected network command failed")
          result = event.result
        }
      }
    }
    cancellation.throwIfAborted()
    execution.assertOwned(epoch)
    if (!result || buffered) throw new Error("network command did not complete")
    return result
  } finally {
    try {
      if (attempted) {
        const stopped = await (await rpc("/stop",{id})).json() as {ok:boolean;result:{joined:boolean}}
        if (!stopped.ok || stopped.result?.joined !== true) throw new Error("network retirement unconfirmed")
      }
      detach?.()
      command?.release()
      daemon?.release()
    } catch (error) {
      execution.fail(error)
      // Keep admission held until root confirms the complete descendant tree.
      throw error
    }
  }
}
