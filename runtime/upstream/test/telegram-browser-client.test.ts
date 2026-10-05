import { expect, test } from "bun:test"
import { createServer, type Socket } from "node:net"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { runBrowserCommand } from "@opencode-ai/core/telegram-browser-client"

async function daemon(run: (socket: Socket) => void) {
  const directory = await mkdtemp(path.join(tmpdir(), "browser-wire-"))
  const endpoint = path.join(directory, "daemon")
  const sockets = new Set<Socket>()
  const server = createServer(socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); run(socket) })
  await new Promise<void>(resolve => server.listen(endpoint, resolve))
  return { endpoint, close: async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  } }
}

test("browser client sends one pinned run request and handles split response frames", async () => {
  let requests = 0
  const fixture = await daemon(socket => socket.once("data", data => {
    requests++
    expect(JSON.parse(data.toString())).toEqual({ id: 1, method: "run", params: { args: { _: ["goto", "--literal-url"] }, cwd: "/workspace" } })
    socket.write('{"id":1,"result":{"isError":false,"text":"owned ')
    setImmediate(() => socket.end('browser"}}\n'))
  }))
  try {
    expect(await runBrowserCommand(fixture.endpoint, { _: ["goto", "--literal-url"] }, "/workspace", new AbortController().signal, 4096))
      .toEqual({ stdout: "owned browser", stderr: "" })
    expect(requests).toBe(1)
  } finally { await fixture.close() }
})

test("browser client rejects daemon errors, foreign response identities and oversized frames", async () => {
  for (const response of [
    '{"id":1,"error":"navigation failed"}\n',
    '{"id":2,"result":{"text":"foreign"}}\n',
    '{"id":1,"result":{"isError":true,"text":"tool failed"}}\n',
    'x'.repeat(1025),
  ]) {
    const fixture = await daemon(socket => socket.once("data", () => socket.end(response)))
    try { await expect(runBrowserCommand(fixture.endpoint, { _: ["snapshot"] }, "/workspace", new AbortController().signal, 1024)).rejects.toThrow() }
    finally { await fixture.close() }
  }
})

test("browser cancellation closes the request without reconnecting or replaying", async () => {
  let requests = 0
  let entered!: () => void
  const ready = new Promise<void>(resolve => entered = resolve)
  const fixture = await daemon(socket => socket.once("data", () => { requests++; entered() }))
  const controller = new AbortController()
  try {
    const result = runBrowserCommand(fixture.endpoint, { _: ["click", "e1"] }, "/workspace", controller.signal, 1024)
    await ready
    controller.abort(new Error("cancelled browser request"))
    await expect(result).rejects.toThrow("cancelled browser request")
    expect(requests).toBe(1)
  } finally { await fixture.close() }
})
