import { AsyncLocalStorage } from "node:async_hooks"
import { abortableSleep } from "./telegram-deadline"

// Carries the existing ProviderAuth flow's cancellation authority through built-in
// plugin promises. This is not a second workspace registry or credential owner.
const signals = new AsyncLocalStorage<AbortSignal>()
export function runAuthOperation<T>(signal: AbortSignal, start: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  return signals.run(signal, () => Promise.resolve().then(() => {
    signal.throwIfAborted()
    return start()
  }))
}
function ownedFetch(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit): ReturnType<typeof globalThis.fetch> {
  const owner = signals.getStore()
  if (!owner) return globalThis.fetch(input, init)
  owner.throwIfAborted()
  const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  return globalThis.fetch(input, { ...init, signal: caller ? AbortSignal.any([owner, caller]) : owner })
}
export const authFetch: typeof globalThis.fetch = Object.assign(ownedFetch, { preconnect: globalThis.fetch.preconnect })
export function authSleep(ms: number): Promise<void> {
  return abortableSleep(ms, signals.getStore())
}
