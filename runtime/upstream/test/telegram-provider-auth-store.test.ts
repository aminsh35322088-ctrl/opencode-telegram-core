import { expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { McpAuth } from "../../src/mcp/auth"
import { Auth } from "../../src/auth"

function credentialFile(fileName = "auth.json") {
  let data: Record<string, unknown> = {}
  let writeFailure: FSUtil.Error | undefined
  let writeGate: Promise<void> | undefined; let writeEntered: (() => void) | undefined; let writeSettled: (() => void) | undefined
  let writeAborted = false
  const fsLayer = Layer.effect(FSUtil.Service, Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return FSUtil.Service.of({ ...fs,
      readJson: (file) => file.endsWith("/" + fileName) ? Effect.promise(async () => {
        const snapshot = structuredClone(data)
        await Promise.resolve()
        return snapshot
      }) : fs.readJson(file),
      writeJson: (file, value, mode) => file.endsWith("/" + fileName) ? writeFailure ? Effect.fail(writeFailure).pipe(Effect.asVoid) : Effect.promise(async signal => {
        writeEntered?.(); signal.addEventListener("abort", () => { writeAborted = true }, { once: true })
        await writeGate
        data = structuredClone(value) as Record<string, unknown>
        writeSettled?.()
      }) : fs.writeJson(file, value, mode),
    })
  })).pipe(Layer.provide(AppNodeBuilder.build(FSUtil.node)))
  const layer = AppNodeBuilder.build(LayerNode.group([Auth.node, McpAuth.node]), [[FSUtil.node, fsLayer]])
  return { layer, data: () => data, writeAborted: () => writeAborted, failWrite(error: FSUtil.Error) { writeFailure = error }, blockWrite(value: Promise<void>, onWrite: () => void, onSettled: () => void) { writeGate = value; writeEntered = onWrite; writeSettled = onSettled } }
}
test("concurrent provider credential writes preserve both accounts", async () => {
  const file = credentialFile()
  await Effect.runPromise(Effect.gen(function* () {
    const auth = yield* Auth.Service
    yield* Effect.all([
      auth.set("first", { type: "api", key: "fixture-first" }),
      auth.set("second", { type: "api", key: "fixture-second" }),
    ], { concurrency: "unbounded" })
    expect(Object.keys(file.data()).sort()).toEqual(["first", "second"])
  }).pipe(Effect.provide(file.layer)))
})

test("concurrent provider removal and update preserve the unrelated account", async () => {
  const file = credentialFile()
  await Effect.runPromise(Effect.gen(function* () {
    const auth = yield* Auth.Service
    yield* auth.set("first", { type: "api", key: "fixture-first" })
    yield* Effect.all([
      auth.remove("first"), auth.set("second", { type: "api", key: "fixture-second" }),
    ], { concurrency: "unbounded" })
    expect(Object.keys(file.data())).toEqual(["second"])
  }).pipe(Effect.provide(file.layer)))
})

test("credential cancellation cannot interrupt an admitted filesystem mutation", async () => {
  const file = credentialFile()
  let entered!: () => void; let release!: () => void; let settled!: () => void
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const complete = new Promise<void>(resolve => { settled = resolve })
  file.blockWrite(gate, entered, settled)
  await Effect.runPromise(Effect.gen(function* () {
    const auth = yield* Auth.Service
    const write = yield* auth.set("first", { type: "api", key: "fixture-first" }).pipe(Effect.forkChild)
    yield* Effect.promise(() => observed)
    const stopping = yield* Fiber.interrupt(write).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(file.writeAborted()).toBe(false)
    release()
    yield* Fiber.join(stopping)
    yield* Effect.promise(() => complete)
    expect(Object.keys(file.data())).toEqual(["first"])
  }).pipe(Effect.provide(file.layer), Effect.ensuring(Effect.sync(release))))
})

test("MCP credential cancellation cannot release a lock before admitted write settlement", async () => {
  const file = credentialFile("mcp-auth.json")
  let entered!: () => void; let release!: () => void; let settled!: () => void
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const complete = new Promise<void>(resolve => { settled = resolve })
  file.blockWrite(gate, entered, settled)
  await Effect.runPromise(Effect.gen(function* () {
    const auth = yield* McpAuth.Service
    const write = yield* auth.updateTokens("first", { accessToken: "fixture-token" }).pipe(Effect.forkChild)
    yield* Effect.promise(() => observed)
    const stopping = yield* Fiber.interrupt(write).pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(file.writeAborted()).toBe(false)
    release(); yield* Fiber.join(stopping); yield* Effect.promise(() => complete)
    expect(Object.keys(file.data())).toEqual(["first"])
  }).pipe(Effect.provide(file.layer), Effect.ensuring(Effect.sync(release))))
})

test("provider write failures remain recoverable AuthError values", async () => {
  const file = credentialFile(); file.failWrite(new FSUtil.FileSystemError({method:"writeJson",cause:new Error("fixture filesystem failure")}))
  await Effect.runPromise(Effect.gen(function* () {
    const auth = yield* Auth.Service
    for (const operation of [auth.set("first", {type:"api",key:"fixture"}), auth.remove("first")]) {
      const message = yield* operation.pipe(Effect.catchTag("AuthError", error => Effect.succeed(error.message)))
      expect(message).toBe("Failed to write auth data")
    }
  }).pipe(Effect.provide(file.layer)))
})
