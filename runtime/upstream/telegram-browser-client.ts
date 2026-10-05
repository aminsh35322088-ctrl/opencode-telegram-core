import { createConnection } from "node:net"

/** Pinned Playwright CLI daemon framing. The workspace owner supplies the endpoint. */
export function runBrowserCommand(
  endpoint: string,
  args: { _: string[]; filename?: string },
  cwd: string,
  signal: AbortSignal,
  maxBuffer: number,
  beforeSend: () => Promise<void> = async () => {},
): Promise<{ stdout: string; stderr: string }> {
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1 || maxBuffer > 16 * 1024 * 1024)
    return Promise.reject(new Error("invalid browser output limit"))
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint)
    let finished = false, bytes = 0
    const buffers: Buffer[] = []
    const finish = (error?: unknown, text = "") => {
      if (finished) return
      finished = true
      signal.removeEventListener("abort", abort)
      buffers.length = 0
      socket.destroy()
      if (error !== undefined) reject(error)
      else resolve({ stdout: text, stderr: "" })
    }
    const abort = () => finish(signal.reason ?? new Error("browser request aborted"))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) { abort(); return }
    socket.once("error", finish)
    socket.once("close", () => { if (!finished) finish(new Error("owned browser connection closed before response")) })
    socket.once("connect", () => {
      void beforeSend().then(() => {
        if (finished) return
        signal.throwIfAborted()
        const request = JSON.stringify({ id: 1, method: "run", params: { args, cwd } }) + "\n"
        if (Buffer.byteLength(request) > 256 * 1024) throw new Error("browser request limit exceeded")
        socket.write(request, error => { if (error) finish(error) })
      }).catch(finish)
    })
    socket.on("data", (buffer: Buffer) => {
      if (finished) return
      bytes += buffer.length
      if (bytes > maxBuffer) { finish(new Error("browser response limit exceeded")); return }
      const newline = buffer.indexOf(10)
      buffers.push(newline < 0 ? buffer : buffer.subarray(0, newline))
      if (newline < 0) return
      try {
        if (buffer.subarray(newline + 1).toString().trim()) throw new Error("unexpected browser response frames")
        const response = JSON.parse(Buffer.concat(buffers).toString("utf8"))
        if (response.id !== 1) throw new Error("unexpected browser response identity")
        if (typeof response.error === "string") throw new Error(response.error)
        if (!response.result || (response.result.text !== undefined && typeof response.result.text !== "string"))
          throw new Error("invalid browser response")
        if (response.result.isError) throw new Error(response.result.text || "browser command failed")
        finish(undefined, response.result.text ?? "")
      } catch (error) { finish(error) }
    })
  })
}
