import { pathToFileURL } from "node:url"
import path from "node:path"

const root = process.cwd()
const manifestPath = path.join(root, "runtime/compat/opencode-telegram-bot-sdk-surface.json")
const sdkDirectory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "dist/sdk")
const sdkClientPath = path.join(sdkDirectory, "v2/client.js")

const manifest = await Bun.file(manifestPath).json() as {
  required: string[]
  targetRequired: string[]
}
const module = await import(pathToFileURL(sdkClientPath).href)
const createOpencodeClient = module.createOpencodeClient as (config: unknown) => Record<string, unknown>
if (typeof createOpencodeClient !== "function") {
  throw new Error("generated SDK does not export createOpencodeClient")
}

const requests: Request[] = []
const client = createOpencodeClient({
  baseUrl: "http://127.0.0.1:1",
  fetch: async (request: Request) => {
    requests.push(request)
    return new Response("{}", { headers: { "content-type": "application/json" } })
  },
})

const missing: string[] = []
for (const member of [...manifest.required, ...manifest.targetRequired]) {
  let value: unknown = client
  for (const segment of member.split(".")) {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) {
      value = undefined
      break
    }
    value = Reflect.get(value, segment)
  }
  if (typeof value !== "function") missing.push(member)
}

if (missing.length > 0) {
  throw new Error("OpenCode SDK no longer satisfies Telegram bot contract: " + missing.join(", "))
}
console.log(`bot SDK surface verified: ${manifest.required.length} current members + ${manifest.targetRequired.length} target control members`)

const session = client.session as Record<string, (input: Record<string, string>) => Promise<unknown>>
await session.execution({ sessionID: "sdk-contract", directory: "/topics/one" })
const inspected = requests.at(-1)!
if (inspected.method !== "GET" || new URL(inspected.url).pathname !== "/session/sdk-contract/execution" ||
  new URL(inspected.url).searchParams.get("directory") !== "/topics/one") {
  throw new Error("generated SDK lost directory-bound execution inspection")
}

for (const operation of ["pause", "resume", "abort"]) {
  await session[operation]({ sessionID: "sdk-contract", directory: "/topics/one", runId: "opaque-owner" })
  const request = requests.at(-1)!
  const url = new URL(request.url)
  const body = await request.json() as { runId?: string }
  if (request.method !== "POST" || url.pathname !== `/session/sdk-contract/${operation}` ||
    url.searchParams.get("directory") !== "/topics/one" || body.runId !== "opaque-owner") {
    throw new Error(`generated SDK lost execution ownership in session.${operation}`)
  }
}
console.log("generated SDK execution controls retain directory and run identity")

const origin = {
  version: 1,
  root: { sessionId: "sdk-contract", runId: "original-run", directory: "/topics/one" },
  producer: { sessionId: "sdk-child", runId: "child-run", directory: "/topics/one" },
  epoch: 1,
}
const streamingClient = createOpencodeClient({
  baseUrl: "http://127.0.0.1:1",
  fetch: async () => new Response(
    `data: ${JSON.stringify({ type: "session.status", properties: { sessionID: "sdk-child", status: { type: "busy" } }, metadata: { telegramExecution: origin } })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  ),
})
const events = streamingClient.event as {
  subscribe: (parameters: { directory: string }, options: { signal: AbortSignal }) => Promise<{ stream: AsyncGenerator<unknown> }>
}
const controller = new AbortController()
try {
  const { stream } = await events.subscribe({ directory: "/topics/one" }, { signal: controller.signal })
  const next = await stream.next()
  const event = next.value as { metadata?: { telegramExecution?: unknown } } | undefined
  if (next.done || JSON.stringify(event?.metadata?.telegramExecution) !== JSON.stringify(origin))
    throw new Error("generated SDK lost original execution provenance in SSE delivery")
  await stream.return()
} finally {
  controller.abort()
}
console.log("generated SDK SSE retains original root, child producer and execution phase")
