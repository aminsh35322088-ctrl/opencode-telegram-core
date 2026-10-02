// External server fixture: its descendant inherits the transport's OS group.
import { spawn } from "node:child_process"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
const child = spawn("/bin/bash", ["-c", "trap '' TERM; exec sleep 60"], { stdio: "ignore" })
await Bun.write(process.env.MCP_TEST_CHILD_PID!, String(child.pid))
process.on("SIGTERM", () => {})
const server = new Server({ name: "owned-service", version: "1.0.0" }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))
await server.connect(new StdioServerTransport())
