import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { processScopeBinary } from "./telegram-process-scope-binary"

export interface ProcessTree {
  signal(value: NodeJS.Signals): void
  transition(value: "SIGSTOP" | "SIGCONT"): Promise<void>
  readonly spawnError: NodeJS.ErrnoException | undefined
  cleanup(): Promise<void>
}

const trees = new WeakMap<ChildProcess, ProcessTree>()
let executable: string | undefined
let fatal: ((error: Error) => void) | undefined

// Only the production entrypoint installs fatal container recovery. Generic
// library tests must never acquire authority to exit their host process.
export function installProcessTreeFatalHandler(handler: (error: Error) => void): void {
  fatal = handler
}

export function processTree(proc: ChildProcess): ProcessTree | undefined {
  return trees.get(proc)
}

function binary(): string {
  if (executable) return executable
  const directory = mkdtempSync(path.join(tmpdir(), "opencode-process-scope-"))
  executable = path.join(directory, "scope")
  writeFileSync(executable, Buffer.from(processScopeBinary, "base64"), { mode: 0o500, flag: "wx" })
  return executable
}

/** Existing caller retains admission, workspace and execution authority. */
export function spawnProcessTree(command: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  if (process.platform !== "linux") throw new Error("process-tree containment requires Linux")
  const stdio = options.stdio ?? ["pipe", "pipe", "pipe"]
  if (!Array.isArray(stdio) || stdio.length !== 3)
    throw new Error("process-tree scope requires explicit stdin/stdout/stderr")
  const actualCommand = options.shell ? typeof options.shell === "string" ? options.shell : "/bin/sh" : command
  const actualArgs = options.shell ? ["-c", [command, ...args].join(" ")] : [...args]
  const scopeDirectory = mkdtempSync(path.join(tmpdir(), "oc-scope-"))
  const socketPath = path.join(scopeDirectory, "control")
  let control: Socket | undefined
  const pending: string[] = []
  const listener = createServer()
  listener.listen(socketPath)
  const child = spawn(binary(), ["transient", socketPath, actualCommand, ...actualArgs], {
    ...options, shell: false, detached: true, stdio,
  })
  let empty = false
  let failure: Error | undefined
  let execErrno = false
  let execFailure: NodeJS.ErrnoException | undefined
  const transitions: { command: string; resolve: () => void; reject: (error: Error) => void }[] = []
  let resolve!: () => void
  let reject!: (error: Error) => void
  const confirmed = new Promise<void>((ok, no) => { resolve = ok; reject = no })
  void confirmed.catch(() => {})
  const fail = (reason: string | Error) => {
    if (empty || failure) return
    failure = reason instanceof Error ? reason : new Error(reason)
    reject(failure)
    for (const pending of transitions.splice(0)) pending.reject(failure)
    listener.close()
    fatal?.(failure)
  }
  const send = (command: string, receipt?: { resolve: () => void; reject: (error: Error) => void }) => {
    if (empty) return
    if (failure) throw failure
    if (command === "P" || command === "R") transitions.push({ command, resolve: receipt?.resolve ?? (() => {}), reject: receipt?.reject ?? (() => {}) })
    if (!control) { pending.push(command); return }
    control.write(command, (error) => { if (error) fail(error) })
  }
  listener.on("error", fail)
  listener.on("connection", (socket) => {
    if (control || failure) { socket.destroy(); return }
    control = socket
    listener.close()
    socket.on("error", fail)
    socket.on("data", (chunk: Buffer) => {
      for (const byte of chunk) {
        if (execErrno) {
          execErrno = false
          execFailure = Object.assign(new Error(`process exec failed: ${command}`), {
            errno: -byte, code: byte === 2 ? "ENOENT" : byte === 13 ? "EACCES" : "EXEC_FAILED", syscall: "spawn", path: command,
          })
        }
        else if (byte === 69) execErrno = true
        else if (byte === 68) {
          empty = true; resolve() // D: waitpid confirmed ECHILD
          for (const pending of transitions.splice(0)) pending.reject(new Error("process tree retired during transition"))
          if (execFailure) queueMicrotask(() => child.emit("error", execFailure))
        }
        else if (byte === 80 || byte === 82) {
          const pending = transitions.shift()
          if (!pending || pending.command.charCodeAt(0) !== byte) fail("unexpected process-tree transition receipt")
          else pending.resolve()
        }
        else if (byte !== 83) fail("invalid process-tree receipt")
      }
    })
    socket.on("end", () => {
      if (!empty) fail("process-tree control lost before confirmed retirement")
      socket.destroy()
      rmSync(scopeDirectory, { recursive: true, force: true })
    })
    for (const command of pending.splice(0)) socket.write(command, (error) => { if (error) fail(error) })
  })
  child.once("error", fail)
  child.once("exit", () => {
    // The socket may deliver the final receipt after the wait notification. Never
    // depend on close: escaped survivors can still hold inherited output pipes.
    const timer = setTimeout(() => { if (!empty) fail("process-tree runner lost before confirmed retirement") }, 100)
    void confirmed.then(() => clearTimeout(timer), () => clearTimeout(timer))
  })
  const tree: ProcessTree = {
    signal: (value) => send(value === "SIGSTOP" ? "P" : value === "SIGCONT" ? "R" : "K"),
    transition: (value) => {
      if (empty) return Promise.reject(new Error("process tree retired"))
      return new Promise<void>((resolve, reject) => {
        try { send(value === "SIGSTOP" ? "P" : "R", { resolve, reject }) } catch (error) { reject(error) }
      })
    },
    get spawnError() { return execFailure },
    cleanup: () => { send("K"); return confirmed },
  }
  trees.set(child, tree)
  return child
}
