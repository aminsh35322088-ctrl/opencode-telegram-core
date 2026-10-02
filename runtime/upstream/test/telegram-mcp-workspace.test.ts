import { expect, spyOn } from "bun:test"
import path from "node:path"
import { Effect, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Process } from "../../src/util/process"
import { MCP } from "../../src/mcp/index"
import { McpCatalog } from "../../src/mcp/catalog"
import { StdioClientTransport } from "../../src/mcp/telegram-stdio"
import { disposeInstance } from "../../src/effect/instance-registry"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(MCP.node))
it.instance("MCP workspace disposal rejects delayed client publication", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const directory = (yield* TestInstance).directory
  const mcp = yield* MCP.Service
  const clients = yield* mcp.clients()
  let entered!: () => void
  let release!: () => void
  let closing!: () => void
  const acquiring = new Promise<void>((resolve) => { entered = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  const disposing = new Promise<void>((resolve) => { closing = resolve })
  const originalDefs = McpCatalog.defs
  const defs = spyOn(McpCatalog, "defs").mockImplementation((client, timeout) =>
    originalDefs(client, timeout).pipe(Effect.tap(() => Effect.promise(async () => { entered(); await gate }))),
  )
  const originalClose = StdioClientTransport.prototype.close
  const close = spyOn(StdioClientTransport.prototype, "close").mockImplementation(function(this: StdioClientTransport) {
    return originalClose.call(this).then(() => { closing() })
  })
  const pending = yield* mcp.add("late-server", {
    type: "local", command: [process.execPath, path.join(import.meta.dir, "telegram-mcp-service.fixture.ts")],
    environment: { MCP_TEST_CHILD_PID: path.join(directory, "late.pid") }, timeout: 5000,
  }).pipe(Effect.forkChild)
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => acquiring)
    const disposal = yield* Effect.promise(() => disposeInstance(directory)).pipe(Effect.forkChild)
    yield* Effect.promise(() => disposing)
    yield* Effect.sync(release)
    yield* Fiber.await(pending)
    yield* Fiber.join(disposal)
    expect(Object.keys(clients)).toEqual([])
  }).pipe(Effect.ensuring(Effect.gen(function* () {
    yield* Effect.sync(release)
    yield* Fiber.await(pending)
    yield* Effect.sync(() => { defs.mockRestore(); close.mockRestore() })
  })))
}))

it.instance("overlapping MCP connects serialize service replacement", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const directory = (yield* TestInstance).directory
  const mcp = yield* MCP.Service
  const config = {
    type: "local" as const,
    command: [process.execPath, path.join(import.meta.dir, "telegram-mcp-service.fixture.ts")],
    environment: { MCP_TEST_CHILD_PID: path.join(directory, "overlap.pid") }, timeout: 5000,
  }
  const outcomes = yield* Effect.all([
    mcp.add("racing-server", config).pipe(Effect.map((result) => ("racing-server" in result.status ? result.status["racing-server"]?.status : undefined))),
    mcp.add("racing-server", config).pipe(Effect.map((result) => ("racing-server" in result.status ? result.status["racing-server"]?.status : undefined))),
  ] as const, { concurrency: "unbounded" })
  expect(outcomes).toEqual(["connected", "connected"])
  expect(Object.keys(yield* mcp.clients())).toEqual(["racing-server"])
  yield* mcp.disconnect("racing-server")
}))


it.instance("queued MCP disconnect retires the current replacement", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const directory = (yield* TestInstance).directory
  const mcp = yield* MCP.Service
  // Initialize the workspace before launching the ordered concurrent operations.
  yield* mcp.clients()
  const launch = Process.spawn
  const retired: boolean[] = []
  const spawn = spyOn(Process, "spawn").mockImplementation((cmd, options) => {
    const child = launch(cmd, options)
    const index = retired.push(false) - 1
    void child.exited.then(() => { retired[index] = true }, () => undefined)
    return child
  })
  const config = {
    type: "local" as const,
    command: [process.execPath, path.join(import.meta.dir, "telegram-mcp-service.fixture.ts")],
    environment: { MCP_TEST_CHILD_PID: path.join(directory, "queued-disconnect.pid") }, timeout: 5000,
  }
  yield* Effect.gen(function* () {
    yield* Effect.all([
      mcp.add("queued-server", config), mcp.add("queued-server", config), mcp.disconnect("queued-server"),
    ] as const, { concurrency: "unbounded" })
    expect(retired).toEqual([true, true])
    expect(Object.keys(yield* mcp.clients())).toEqual([])
  }).pipe(Effect.ensuring(Effect.sync(() => spawn.mockRestore())))
}))
