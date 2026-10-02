import { InstallationVersion } from "@opencode-ai/core/installation/version"

declare global {
  const OPENCODE_TELEGRAM_CORE_VERSION: string
  const OPENCODE_TELEGRAM_CORE_COMMIT: string
  const OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT: string
  const OPENCODE_TELEGRAM_CORE_SDK_REVISION: string
}

const argv = process.argv.slice(2)

function optionValues(name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (arg === name) {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`)
      values.push(value)
      index += 1
      continue
    }
    if (arg.startsWith(name + "=")) values.push(arg.slice(name.length + 1))
  }
  return values
}

function optionValue(name: string, fallback?: string): string | undefined {
  return optionValues(name).at(-1) ?? fallback
}

function booleanOption(name: string, fallback: boolean): boolean {
  if (argv.includes("--no-" + name.slice(2))) return false
  const direct = argv.find((arg) => arg === name || arg.startsWith(name + "="))
  if (!direct) return fallback
  if (direct === name) return true
  const value = direct.slice(name.length + 1).toLowerCase()
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  throw new Error(`invalid boolean value for ${name}: ${value}`)
}

function printHelp(): void {
  console.log([
    "OpenCode Telegram headless runtime",
    "",
    "Usage:",
    "  opencode serve [--hostname HOST] [--port PORT] [--cors ORIGIN] [--mdns]",
    "  opencode --version",
    "  opencode debug build-info",
    "",
    "This production profile intentionally excludes TUI, Web UI, Desktop and unrelated CLI commands.",
  ].join("\n"))
}

async function main(): Promise<void> {
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(InstallationVersion)
    return
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp()
    return
  }
  if (argv[0] === "debug" && argv[1] === "build-info") {
    console.log(JSON.stringify({
      upstreamVersion: InstallationVersion,
      upstreamCommit: OPENCODE_TELEGRAM_CORE_UPSTREAM_COMMIT,
      telegramCoreVersion: OPENCODE_TELEGRAM_CORE_VERSION,
      telegramCoreCommit: OPENCODE_TELEGRAM_CORE_COMMIT,
      sdkRevision: OPENCODE_TELEGRAM_CORE_SDK_REVISION,
      runtimeProfile: "telegram-headless",
      embeddedWebUi: false,
    }))
    return
  }

  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "serve"
  if (command !== "serve") throw new Error(`unsupported command in Telegram headless profile: ${command}`)

  if (argv.includes("--pure")) process.env.OPENCODE_PURE = "1"
  if (argv.includes("--print-logs")) process.env.OPENCODE_PRINT_LOGS = "1"
  const logLevel = optionValue("--log-level")
  if (logLevel) process.env.OPENCODE_LOG_LEVEL = logLevel

  process.env.AGENT = "1"
  process.env.OPENCODE = "1"
  process.env.OPENCODE_PID = String(process.pid)
  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"
  // This production profile owns admission independently of its Telegram client.
  // Set before loading Server/runtime modules; inherited opt-out is not allowed.
  process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1"

  const portText = optionValue("--port", process.env.PORT ?? "0")!
  const port = Number(portText)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error(`invalid port: ${portText}`)

  const mdns = booleanOption("--mdns", false)
  const hostname = optionValue("--hostname", mdns ? "0.0.0.0" : "127.0.0.1")!
  const mdnsDomain = optionValue("--mdns-domain", "opencode.local")
  const cors = optionValues("--cors")

  const { Server } = await import("./server/server")
  const server = await Server.listen({ hostname, port, mdns, mdnsDomain, cors })
  console.log(`opencode telegram headless server listening on http://${server.hostname}:${server.port}`)

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await server.stop(true)
    process.exit(0)
  }
  process.on("SIGTERM", () => void stop())
  process.on("SIGINT", () => void stop())
  await new Promise<void>(() => {})
}

await main()
