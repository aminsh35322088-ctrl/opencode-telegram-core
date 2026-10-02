import { PassThrough } from "node:stream"
import { getDefaultEnvironment, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { Process } from "@/util/process"

/** SDK framing with Core-owned workspace process lifetime, never SDK-private spawn state. */
export class StdioClientTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private child?: Process.Child
  private readonly buffer = new ReadBuffer()
  private readonly stderrStream: PassThrough | null
  private started = false
  private closing = false
  private notified = false
  private cleanup?: Promise<void>

  constructor(private readonly params: StdioServerParameters) {
    if (params.stderr !== undefined && params.stderr !== "pipe" && params.stderr !== "inherit" && params.stderr !== "ignore") {
      throw new Error("unsupported MCP stderr mode")
    }
    this.stderrStream = params.stderr === "pipe" ? new PassThrough() : null
  }
  get pid() { return this.child?.pid ?? null }
  get stderr() { return this.stderrStream ?? this.child?.stderr ?? null }

  async start() {
    if (process.platform === "win32") throw new Error("MCP workspace service requires POSIX group ownership")
    if (this.started || this.closing) throw new Error("MCP stdio transport already started or closed")
    this.started = true
    const child = Process.spawn([this.params.command, ...this.params.args ?? []], {
      cwd: this.params.cwd,
      env: { ...getDefaultEnvironment(), ...this.params.env, OPENCODE_TELEGRAM_PROCESS_KIND: "mcp" },
      stdin: "pipe", stdout: "pipe", stderr: this.params.stderr as "pipe" | "inherit" | "ignore" | undefined ?? "inherit",
    })
    this.child = child
    child.stdin?.on("error", (error) => this.onerror?.(error))
    child.stdout?.on("error", (error) => this.onerror?.(error))
    child.stdout?.on("data", (chunk: Buffer) => {
      if (this.closing) return
      this.buffer.append(chunk)
      while (true) {
        try {
          const message = this.buffer.readMessage()
          if (message === null) break
          this.onmessage?.(message)
        } catch (error) { this.onerror?.(error as Error) }
      }
    })
    if (this.stderrStream && child.stderr) child.stderr.pipe(this.stderrStream)
    void child.exited.then(() => this.finish(), (error) => {
      this.onerror?.(error as Error)
      this.finish()
    })
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve())
      child.once("error", reject)
    })
  }
  private finish() {
    this.closing = true
    this.buffer.clear()
    this.stderrStream?.end()
    if (this.notified) return
    this.notified = true
    this.onclose?.()
  }
  close(): Promise<void> {
    this.closing = true
    return this.cleanup ??= (async () => {
      if (this.child) {
        await Process.stop(this.child)
        await this.child.exited
      }
      this.finish()
    })()
  }
  async send(message: JSONRPCMessage) {
    const stdin = this.child?.stdin
    if (this.closing || !stdin || stdin.destroyed || stdin.writableEnded) throw new Error("MCP stdio transport not connected")
    await new Promise<void>((resolve, reject) => {
      stdin.write(serializeMessage(message), (error) => error ? reject(error) : resolve())
    })
  }
}
