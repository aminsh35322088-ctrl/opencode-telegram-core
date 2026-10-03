import { expect, test, spyOn } from "bun:test"
import { createServer, type Socket } from "node:net"
import { once } from "node:events"
import { acquireService, serviceFetch } from "@opencode-ai/core/telegram-service-acquisition"
import { withTimeout } from "../../src/util/timeout"
import { Npm } from "@opencode-ai/core/npm"
import { tmpdir } from "../fixture/fixture"
import { createRequire } from "node:module"

const coreRequire = createRequire(import.meta.resolve("@opencode-ai/core/npm"))
const arboristRequire = createRequire(coreRequire.resolve("@npmcli/arborist"))
const pacoteRequire = createRequire(arboristRequire.resolve("pacote"))
const registryRequire = createRequire(pacoteRequire.resolve("npm-registry-fetch"))
const npmFetch = registryRequire("make-fetch-happen") as (
  url: string, options: Record<string, unknown>,
) => Promise<{ text(): Promise<string> }>

test("workspace startup cancellation closes an in-flight download", async () => {
  const previousNoProxy = process.env.NO_PROXY
  process.env.NO_PROXY = "127.0.0.1"
  let entered!: () => void
  let closed!: () => void
  const receiving = new Promise<void>((resolve) => { entered = resolve })
  const disconnected = new Promise<void>((resolve) => { closed = resolve })
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => { sockets.delete(socket); closed() })
    socket.once("data", entered)
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  const controller = new AbortController()
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing HTTP listener")
  const download = acquireService({ signal: controller.signal, register: () => {} }, () =>
    serviceFetch(`http://127.0.0.1:${address.port}/pending`),
  )
  void download.catch(() => undefined)
  try {
    await withTimeout(receiving, 5000, "download never reached local fixture")
    controller.abort(new Error("workspace closed"))
    await expect(withTimeout(download, 5000)).rejects.toThrow("workspace closed")
    await withTimeout(disconnected, 5000, "cancelled download connection remained open")
  } finally {
    controller.abort()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousNoProxy === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = previousNoProxy
  }
})

test("npm cancellation stops an already scheduled retry backoff", async () => {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const allocate = spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
    const timer = Reflect.apply(originalSetTimeout, globalThis, args) as ReturnType<typeof setTimeout>
    if (args[1] === 60000) timers.add(timer)
    return timer
  }) as typeof setTimeout)
  const retire = spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
    timers.delete(timer as ReturnType<typeof setTimeout>)
    Reflect.apply(originalClearTimeout, globalThis, [timer])
  })
  let retried!: () => void
  const retrying = new Promise<void>((resolve) => { retried = resolve })
  const sockets = new Set<Socket>()
  let requests = 0
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.once("data", () => {
      requests++
      socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    })
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing retry fixture")
  const controller = new AbortController()
  const request = npmFetch(`http://127.0.0.1:${address.port}/retry`, {
    signal: controller.signal, noProxy: "127.0.0.1",
    retry: { retries: 2, minTimeout: 60000, maxTimeout: 60000 }, onRetry: retried,
  })
  void request.catch(() => undefined)
  try {
    await withTimeout(retrying, 5000, "request did not enter retry")
    // Let the retry callback's microtasks schedule backoff before cancellation.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(timers.size).toBe(1)
    controller.abort(new Error("workspace closed"))
    await expect(withTimeout(request, 5000)).rejects.toThrow("workspace closed")
    expect(timers.size).toBe(0)
    expect(requests).toBe(1)
  } finally {
    controller.abort()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    for (const timer of timers) originalClearTimeout(timer)
    allocate.mockRestore(); retire.mockRestore()
  }
})

test("npm fetch retains ordinary retries before workspace cancellation", async () => {
  let requests = 0
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.once("data", () => {
      requests++
      socket.end(requests === 1
        ? "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        : "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
    })
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing retry fixture")
  const controller = new AbortController()
  try {
    const response = await withTimeout(npmFetch(`http://127.0.0.1:${address.port}/retry`, {
      signal: controller.signal, noProxy: "127.0.0.1",
      retry: { retries: 1, minTimeout: 1, maxTimeout: 1 },
    }), 5000)
    expect(await response.text()).toBe("ok")
    expect(requests).toBe(2)
  } finally {
    controller.abort()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("workspace startup cancellation closes npm installation network work", async () => {
  await using temporary = await tmpdir()
  await Bun.write(`${temporary.path}/package.json`, JSON.stringify({ name: "core-owned-install-test", version: "1.0.0" }))
  const previousRegistry = process.env.npm_config_registry
  const previousNoProxy = process.env.NO_PROXY
  const sockets = new Set<Socket>()
  const controller = new AbortController()
  let closed!: () => void
  const disconnected = new Promise<void>((resolve) => { closed = resolve })
  let entered!: () => void
  const receiving = new Promise<void>((resolve) => { entered = resolve })
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => {
      sockets.delete(socket)
      if (controller.signal.aborted && sockets.size === 0) closed()
    })
    socket.once("data", entered)
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("missing npm registry listener")
  process.env.npm_config_registry = `http://127.0.0.1:${address.port}`
  process.env.NO_PROXY = "127.0.0.1"
  const install = acquireService({ signal: controller.signal, register: () => {} }, () =>
    Npm.install(temporary.path, { add: [{ name: "core-owned-cancel-fixture", version: "1.0.0" }] }),
  )
  const result = install.then(() => "completed", () => "cancelled")
  try {
    await withTimeout(receiving, 5000, "npm never reached local registry fixture")
    controller.abort(new Error("workspace closed"))
    expect(await withTimeout(result, 5000, "npm startup remained pending after cancellation")).toBe("cancelled")
    await withTimeout(disconnected, 5000, "cancelled npm registry connection remained open")
    expect(sockets.size).toBe(0)
  } finally {
    controller.abort()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousRegistry === undefined) delete process.env.npm_config_registry
    else process.env.npm_config_registry = previousRegistry
    if (previousNoProxy === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = previousNoProxy
  }
})
