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

function printHelp(): void {
  console.log([
    "OpenCode Telegram headless runtime",
    "",
    "Usage:",
    "  opencode serve [--hostname HOST] [--port PORT] [--cors ORIGIN]",
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

  for (const option of ["--mdns", "--mdns-domain"]) {
    if (argv.some((arg) => arg === option || arg.startsWith(option + "="))) {
      throw new Error(`${option} is unsupported by Telegram Core`)
    }
  }
  if (process.env.OPENCODE_CONSOLE_TOKEN) throw new Error("Upstream Console account integration is unavailable in Telegram Core; configure a provider credential")
  if (process.env.OPENCODE_WORKSPACE_ID) throw new Error("Remote workspace routing is unavailable in Telegram Core")
  for (const name of ["OPENCODE_EXPERIMENTAL_CODE_MODE", "OPENCODE_AUTO_SHARE"]) {
    if (["1", "true"].includes(process.env[name]?.toLowerCase() ?? "")) {
      throw new Error(`${name} is unsupported by Telegram Core`)
    }
  }

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

  const hostname = optionValue("--hostname", "127.0.0.1")!
  const cors = optionValues("--cors")

  const { Server } = await import("./server/server")
  const server = await Server.listen({ hostname, port, cors })
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
