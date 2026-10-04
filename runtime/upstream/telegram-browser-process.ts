import { constants } from "node:fs"
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ChildProcess } from "node:child_process"
import type { SessionExecutionLease } from "./session-execution-control"
import type { ToolProcessPort } from "./telegram-tool-process-contract"
import { acquireTelegramProcessBudget } from "./telegram-process-budget"
import { ownServiceProcess } from "./telegram-service-process"
import { processTree, spawnProcessTree } from "./telegram-process-tree"
import { withDeadline } from "./telegram-deadline"

const actions = new Set([
  "open", "goto", "back", "forward", "reload", "snapshot", "screenshot", "click", "fill", "type", "press",
  "hover", "check", "uncheck", "select", "close", "tab-list", "tab-new", "tab-select", "tab-close",
  "requests", "console", "pdf",
])
type BrowserRequest = Parameters<ToolProcessPort["browser"]>[0]
interface Browser {
  readonly identity: string
  readonly directory: string
  readonly node: string
  readonly cli: string
  readonly env: NodeJS.ProcessEnv
  readonly process: ChildProcess
  readonly ready: Promise<void>
  readonly cleanup: () => Promise<void>
  dead: boolean
}

async function executable(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory, name)
    try { await access(candidate, constants.X_OK); return await realpath(candidate) } catch {}
  }
  throw new Error(`Required browser runtime is unavailable: ${name}`)
}
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)
}

/** Durable workspace owner; invocation delegates never select a foreign owner. */
export class WorkspaceBrowsers {
  readonly #controller = new AbortController()
  readonly #browsers = new Map<string, Browser>()
  readonly #queues = new Map<string, Promise<unknown>>()
  readonly #pending = new Set<Promise<unknown>>()
  #closing = false
  #cleanup?: Promise<void>

  constructor(readonly directory: string, private readonly assertActive: () => void) {}

  execute(
    execution: SessionExecutionLease,
    epoch: number,
    sessionId: string,
    request: BrowserRequest,
    cancellation: AbortSignal,
    execFile: ToolProcessPort["execFile"],
  ): ReturnType<ToolProcessPort["browser"]> {
    if (this.#closing) return Promise.reject(new Error("browser workspace retired"))
    if (this.#pending.size >= 16) return Promise.reject(new Error("browser request admission limit exceeded"))
    const name = request.session?.trim() || "default"
    if (name.length > 128) return Promise.reject(new Error("browser session name exceeds 128 characters"))
    if (!actions.has(request.action)) return Promise.reject(new Error("unsupported browser action"))
    const key = JSON.stringify([sessionId, name])
    const signal = AbortSignal.any([cancellation, execution.signal, this.#controller.signal])
    const predecessor = this.#queues.get(key) ?? Promise.resolve()
    const operation = predecessor.catch(() => {}).then(async () => {
      const assert = () => {
        this.assertActive()
        signal.throwIfAborted()
        if (this.#closing) throw new Error("browser workspace retired")
        execution.assertOwned(epoch)
        if (execution.owner.directory !== this.directory || execution.owner.sessionId !== sessionId)
          throw new Error("browser execution owner mismatch")
      }
      assert()
      await execution.checkpoint(signal, epoch)
      assert()
      const timeout = request.timeout ?? 120_000
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600_000) throw new Error("invalid browser timeout")
      if ((request.args ?? []).some(argument => typeof argument !== "string" || argument.length > 16_384))
        throw new Error("invalid browser arguments")
      let browser = this.#browsers.get(key)
      if (request.action === "close" || request.action === "open") {
        if (browser) { await browser.cleanup(); this.#browsers.delete(key) }
        if (request.action === "close") return { stdout: "Browser closed", stderr: "" }
        assert()
        browser = await this.#start(key, assert)
      }
      if (!browser || browser.dead) throw new Error("Browser is not open; open a browser in this session first")
      const owned = browser
      const tree = processTree(owned.process)!
      let detach: (() => void) | undefined
      try {
        detach = execution.attach({
          pause: () => tree.signal("SIGSTOP"),
          resume: () => tree.signal("SIGCONT"),
          terminate: () => tree.signal("SIGKILL"),
        })
        await withDeadline(() => owned.ready, { timeoutMs: timeout, label: "browser startup", parentSignal: signal, activity: execution })
        await execution.checkpoint(signal, epoch)
        assert()
        await tree.transition("SIGCONT")
        assert()
        const command = request.action === "open" ? "goto" : request.action
        const args = [`-s=${owned.identity}`]
        if (request.filename) {
          if (command !== "screenshot" && command !== "pdf") throw new Error("filename requires screenshot or pdf")
          const root = await realpath(this.directory)
          const output = path.resolve(root, request.filename)
          if (!inside(root, output)) throw new Error("browser output workspace escape")
          let existing = path.dirname(output)
          while (true) {
            try { if (!inside(root, await realpath(existing))) throw new Error("browser output workspace escape"); break }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
              existing = path.dirname(existing)
            }
          }
          assert()
          await mkdir(path.dirname(output), { recursive: true })
          if (!inside(root, await realpath(path.dirname(output)))) throw new Error("browser output workspace escape")
          const stat = await lstat(output).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
            throw error
          })
          if (stat?.isSymbolicLink()) throw new Error("browser output must not be a symlink")
          assert()
          args.push(`--filename=${output}`)
        }
        args.push(command, "--", ...request.args ?? [])
        const result = await execFile(owned.node, [owned.cli, ...args], {
          cwd: this.directory, env: owned.env, timeout, maxBuffer: request.maxBuffer ?? 2 * 1024 * 1024, signal,
        })
        assert()
        if (owned.dead || this.#browsers.get(key) !== owned) throw new Error("browser authority retired during request")
        return result
      } catch (error) {
        await owned.cleanup()
        if (this.#browsers.get(key) === owned) this.#browsers.delete(key)
        throw error
      } finally {
        detach?.()
        // An idle persistent browser has no running execution delegate. Park it
        // physically, preventing background page work from escaping a Topic's
        // pause/abort lifetime. The next captured request resumes this identity.
        if (!owned.dead && !signal.aborted) await tree.transition("SIGSTOP")
        else if (!owned.dead) await owned.cleanup()
      }
    })
    this.#queues.set(key, operation)
    this.#pending.add(operation)
    const remove = () => {
      this.#pending.delete(operation)
      if (this.#queues.get(key) === operation) this.#queues.delete(key)
    }
    void operation.then(remove, remove)
    return operation
  }

  async #start(key: string, assert: () => void): Promise<Browser> {
    const cli = await executable("playwright-cli")
    const node = await executable("node")
    const metadata = JSON.parse(await readFile(path.join(path.dirname(cli), "package.json"), "utf8"))
    if (metadata.name !== "@playwright/cli" || metadata.version !== "0.1.18")
      throw new Error("unsupported Playwright CLI; required version is 0.1.18")
    const corePackage = createRequire(cli).resolve("playwright-core/package.json")
    const core = JSON.parse(await readFile(corePackage, "utf8"))
    if (core.version !== "1.63.0-alpha-2026-08-05") throw new Error("unsupported pinned Playwright browser runtime")
    assert()
    const directory = await mkdtemp(path.join(tmpdir(), "oc-browser-"))
    const identity = "core-" + randomUUID()
    const config = path.join(directory, "browser.json")
    await writeFile(config, JSON.stringify({ browser: { browserName: "chromium", launchOptions: { channel: "chromium", headless: true } } }))
    const env = { ...process.env }
    for (const name of Object.keys(env)) if (name.startsWith("PLAYWRIGHT_MCP_") || name.startsWith("PWTEST_")) delete env[name]
    env.XDG_CACHE_HOME = directory
    env.PWTEST_CLI_GLOBAL_CONFIG = directory
    env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1"
    env.OPENCODE_TELEGRAM_PROCESS_KIND = "browser"
    assert()
    const lease = acquireTelegramProcessBudget("browser", env, "browser")
    if (!lease) throw new Error("browser admission unavailable")
    let proc: ChildProcess
    try {
      proc = spawnProcessTree(node, [path.join(path.dirname(corePackage), "lib/entry/cliDaemon.js"), identity,
        "--browser", "chromium", "--config", config], { cwd: this.directory, env, stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) { lease.release(); await rm(directory, { recursive: true, force: true }); throw error }
    const ownership = ownServiceProcess(proc, lease)
    let ready!: () => void
    let reject!: (error: Error) => void
    const started = new Promise<void>((ok, no) => { ready = ok; reject = no })
    void started.catch(() => {})
    let bytes = 0, output = ""
    let retirement: Promise<void> | undefined
    const browser: Browser = {
      identity, directory, node, cli, env, process: proc, ready: started, dead: false,
      cleanup: () => retirement ??= (async () => {
        await ownership.cleanup()
        browser.dead = true
        await rm(directory, { recursive: true, force: true })
      })(),
    }
    this.#browsers.set(key, browser)
    const collect = (data: Buffer, stdout: boolean) => {
      bytes += data.length
      if (bytes > 1024 * 1024) {
        reject(new Error("browser daemon output limit exceeded"))
        void browser.cleanup().catch(() => {})
        return
      }
      if (stdout) { output += data.toString(); if (output.includes("Daemon listening on ")) ready() }
    }
    proc.stdout?.on("data", (data: Buffer) => collect(data, true))
    proc.stderr?.on("data", (data: Buffer) => collect(data, false))
    proc.once("error", reject)
    proc.once("exit", () => {
      reject(new Error("browser daemon exited"))
      void browser.cleanup().then(() => { if (this.#browsers.get(key) === browser) this.#browsers.delete(key) }, () => {})
    })
    return browser
  }

  close(): Promise<void> {
    if (this.#cleanup) return this.#cleanup
    this.#closing = true
    this.#controller.abort(new Error("browser workspace retired"))
    return this.#cleanup = withDeadline(async () => {
      // Snapshot before joins: exit callbacks can remove successfully retired
      // entries, but no new entry can pass the closing fence.
      const retirements = Array.from(this.#browsers.values(), browser => browser.cleanup())
      const [cleanup] = await Promise.all([
        Promise.allSettled(retirements),
        Promise.allSettled([...this.#pending]),
      ])
      const failures = cleanup.filter((value): value is PromiseRejectedResult => value.status === "rejected")
      if (failures.length) throw new AggregateError(failures.map(value => value.reason), "browser workspace cleanup uncertain")
      this.#browsers.clear()
    }, { timeoutMs: 10_000, label: "browser workspace retirement" })
  }
}
