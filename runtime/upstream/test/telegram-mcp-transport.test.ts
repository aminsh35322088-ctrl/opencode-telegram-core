import { expect, test, spyOn } from "bun:test"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { Process } from "../../src/util/process"
import { StdioClientTransport } from "../../src/mcp/telegram-stdio"

test("failed service cleanup rejects transport work without announcing confirmed closure", async () => {
  let fail!: (error: Error) => void
  const exited = new Promise<number>((_resolve, reject) => { fail = reject })
  const child = Object.assign(new EventEmitter(), {
    pid: 2147483003, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exited,
  }) as unknown as Process.Child
  const error = new Error("service group cleanup uncertain")
  const spawn = spyOn(Process, "spawn").mockReturnValue(child)
  const stop = spyOn(Process, "stop").mockRejectedValue(error)
  const transport = new StdioClientTransport({ command: "service", stderr: "pipe" })
  let closed = 0
  let notify!: () => void
  const notified = new Promise<void>((resolve) => { notify = resolve })
  transport.onclose = () => { closed++ }
  transport.onerror = () => notify()
  try {
    const started = transport.start()
    child.emit("spawn")
    await started
    fail(error)
    await notified
    expect(closed).toBe(0)
    expect(transport.pid).toBe(child.pid!)
    await expect(transport.send({ jsonrpc: "2.0", method: "test" })).rejects.toThrow("not connected")
    await expect(transport.close()).rejects.toThrow("uncertain")
    expect(closed).toBe(0)
  } finally {
    spawn.mockRestore(); stop.mockRestore()
    child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy()
  }
})
