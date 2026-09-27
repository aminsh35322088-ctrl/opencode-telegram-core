import { pathToFileURL } from "node:url"
import path from "node:path"

const root = process.cwd()
const manifestPath = path.join(root, "runtime/compat/opencode-telegram-bot-sdk-surface.json")
const sdkClientPath = path.join(root, "dist/sdk/v2/client.js")

const manifest = await Bun.file(manifestPath).json() as {
  required: string[]
}
const module = await import(pathToFileURL(sdkClientPath).href)
const createOpencodeClient = module.createOpencodeClient as (config: unknown) => Record<string, unknown>
if (typeof createOpencodeClient !== "function") {
  throw new Error("generated SDK does not export createOpencodeClient")
}

const client = createOpencodeClient({
  baseUrl: "http://127.0.0.1:1",
  fetch: async () => new Response("{}", { headers: { "content-type": "application/json" } }),
})

const missing: string[] = []
for (const member of manifest.required) {
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
console.log(`bot SDK surface verified: ${manifest.required.length} members`)
