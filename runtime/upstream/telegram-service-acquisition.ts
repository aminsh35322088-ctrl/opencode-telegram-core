import { AsyncLocalStorage } from "node:async_hooks"
import type { ChildProcess } from "node:child_process"
import { acquireTelegramProcessBudget } from "./telegram-process-budget"

export interface ServiceProcessOwner {
  readonly signal: AbortSignal
  readonly register: (process: ChildProcess & { exited: Promise<number> }) => void
}

const owners = new AsyncLocalStorage<ServiceProcessOwner>()

export function currentServiceProcessOwner(): ServiceProcessOwner | undefined {
  return owners.getStore()
}

export async function acquireService<T>(owner: ServiceProcessOwner, start: () => Promise<T>): Promise<T> {
  owner.signal.throwIfAborted()
  const lease = acquireTelegramProcessBudget("lsp-startup", undefined, "helper")
  // Keep admission and the captured workspace alive until the underlying startup
  // actually settles, including after a bounded disposal reports uncertainty.
  return owners.run(owner, () => Promise.resolve().then(start)).finally(() => lease?.release())
}

export function serviceFetch(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): ReturnType<typeof globalThis.fetch> {
  const owner = currentServiceProcessOwner()
  if (!owner) return globalThis.fetch(input, init)
  owner.signal.throwIfAborted()
  const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  const signal = requestSignal ? AbortSignal.any([owner.signal, requestSignal]) : owner.signal
  return globalThis.fetch(input, { ...init, signal })
}
