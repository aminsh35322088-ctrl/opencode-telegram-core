import { expect, spyOn, test } from "bun:test"
import { Effect, Fiber, Layer, Exit, Cause } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderAuth } from "../../src/provider/auth"
import { Auth } from "../../src/auth"
import { Plugin } from "../../src/plugin"
import { authSleep, authFetch } from "@opencode-ai/core/telegram-auth-operation"
import { disposeInstance, assertDirectoryAvailable } from "../../src/effect/instance-registry"
import { TestInstance, withTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

let startup: () => Promise<void> = async () => {}
let callback: () => Promise<{ type: "success"; key: string }>
const plugin = Layer.succeed(Plugin.Service, Plugin.Service.of({
  init: () => Effect.void,
  trigger: (_name, _input, output) => Effect.succeed(output),
  list: () => Effect.succeed([{ auth: {
    provider: "telegram-provider-fixture",
    methods: [{ type: "oauth", label: "controlled fixture", authorize: async () => { await startup(); return ({
      url: "https://example.test/authorize", method: "auto", instructions: "fixture",
      callback: () => callback(),
    }) } }],
  } }]),
}))
const layer = LayerNode.compile(LayerNode.group([ProviderAuth.node, Auth.node]), [[Plugin.node, plugin]])
const it = testEffect(layer)
it.instance("retired provider OAuth completion cannot persist credentials", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const auth = yield* Auth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  const directory = (yield* TestInstance).directory
  let entered!: () => void; let release!: () => void
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  callback = async () => { entered(); await gate; return { type: "success", key: "fixture-late-key" } }
  yield* auth.remove(providerID)
  const flow = yield* service.authorize({ providerID, method: 0 })
  const completion = yield* service.callback({ providerID, method: 0, oauthState: flow!.oauthState }).pipe(Effect.forkChild)
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => observed)
    const retirement = disposeInstance(directory)
    release()
    yield* Effect.promise(() => retirement)
    yield* Fiber.await(completion)
    expect(yield* auth.get(providerID)).toBeUndefined()
  }).pipe(Effect.ensuring(Effect.sync(release)), Effect.ensuring(auth.remove(providerID).pipe(Effect.orDie)))
}))
it.instance("completed provider OAuth callback cannot replay its credential exchange", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const auth = yield* Auth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  let exchanges = 0
  callback = async () => { exchanges++; return { type: "success", key: "fixture-replay-key" } }
  yield* Effect.gen(function* () {
    const flow = yield* service.authorize({ providerID, method: 0 })
    yield* service.callback({ providerID, method: 0, oauthState: flow!.oauthState })
    yield* service.callback({ providerID, method: 0, oauthState: flow!.oauthState }).pipe(Effect.exit)
    expect(exchanges).toBe(1)
  }).pipe(Effect.ensuring(auth.remove(providerID).pipe(Effect.orDie)))
}))

it.instance("stale provider callback cannot consume a replacement flow", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service; const auth = yield* Auth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  let exchanges = 0
  callback = async () => { exchanges++; return { type: "success", key: "fixture-current-key" } }
  yield* Effect.gen(function* () {
    const old = yield* service.authorize({ providerID, method: 0 })
    const current = yield* service.authorize({ providerID, method: 0 })
    yield* service.callback({ providerID, method: 0, oauthState: old!.oauthState }).pipe(Effect.exit)
    expect(exchanges).toBe(0)
    yield* service.callback({ providerID, method: 0, oauthState: current!.oauthState })
    expect(exchanges).toBe(1)
  }).pipe(Effect.ensuring(auth.remove(providerID).pipe(Effect.orDie)))
}))

it.instance("simultaneous provider callbacks admit one exchange", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service; const auth = yield* Auth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  let entered!: () => void; let release!: () => void; let exchanges = 0
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  callback = async () => { exchanges++; entered(); await gate; return { type: "success", key: "fixture-key" } }
  yield* Effect.gen(function* () {
    const flow = yield* service.authorize({ providerID, method: 0 })
    const input = { providerID, method: 0, oauthState: flow!.oauthState }
    const first = yield* service.callback(input).pipe(Effect.forkChild)
    yield* Effect.promise(() => observed)
    expect(Exit.isFailure(yield* service.callback(input).pipe(Effect.exit))).toBe(true)
    expect(exchanges).toBe(1)
    release(); yield* Fiber.join(first)
  }).pipe(Effect.ensuring(Effect.sync(release)), Effect.ensuring(auth.remove(providerID).pipe(Effect.orDie)))
}))
it.instance("interrupting provider polling joins its cancellation before returning", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service; const auth = yield* Auth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  let entered!: () => void; let settled = false
  const observed = new Promise<void>(resolve => { entered = resolve })
  callback = async () => { entered(); try { await authSleep(60000); return { type: "success", key: "fixture-key" } } finally { settled = true } }
  const flow = yield* service.authorize({ providerID, method: 0 })
  const input = { providerID, method: 0, oauthState: flow!.oauthState }
  const polling = yield* service.callback(input).pipe(Effect.forkChild)
  yield* Effect.promise(() => observed)
  yield* Fiber.interrupt(polling)
  expect(settled).toBe(true)
  expect(Exit.isFailure(yield* service.callback(input).pipe(Effect.exit))).toBe(true)
  expect(yield* auth.get(providerID)).toBeUndefined()
}))
it.instance("workspace disposal cancels and joins provider polling", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  let entered!: () => void; let settled = false
  const observed = new Promise<void>(resolve => { entered = resolve })
  callback = async () => { entered(); try { await authSleep(60000); return { type: "success", key: "fixture-key" } } finally { settled = true } }
  const flow = yield* service.authorize({ providerID, method: 0 })
  const polling = yield* service.callback({ providerID, method: 0, oauthState: flow!.oauthState }).pipe(Effect.forkChild)
  yield* Effect.promise(() => observed)
  const directory = (yield* TestInstance).directory
  yield* Effect.promise(() => disposeInstance(directory))
  expect(settled).toBe(true)
  expect(Exit.isFailure(yield* Fiber.await(polling))).toBe(true)
}))
it.instance("provider flow expiry revokes only its captured flow", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  const original = globalThis.setTimeout
  let expire!: () => void
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms: number, ...args: unknown[]) => {
    if (ms === 300000) expire = fn
    return original(fn, ms, ...args)
  }) as typeof setTimeout)
  yield* Effect.gen(function* () {
    callback = async () => ({ type: "success", key: "fixture-key" })
    const old = yield* service.authorize({ providerID, method: 0 })
    const expireOld = expire; expireOld()
    expect(Exit.isFailure(yield* service.callback({ providerID, method: 0, oauthState: old!.oauthState }).pipe(Effect.exit))).toBe(true)
    const current = yield* service.authorize({ providerID, method: 0 })
    expireOld() // late invocation must not retire the replacement
    yield* service.callback({ providerID, method: 0, oauthState: current!.oauthState })
  }).pipe(Effect.ensuring(Effect.sync(() => timer.mockRestore())), Effect.ensuring(Auth.Service.use(auth => auth.remove(providerID)).pipe(Effect.orDie)))
}))

it.instance("interrupted provider startup cannot publish a pending flow", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  let entered!: () => void; let settled = false
  const observed = new Promise<void>(resolve => { entered = resolve })
  startup = async () => { entered(); try { await authSleep(60000) } finally { settled = true } }
  yield* Effect.gen(function* () {
    const starting = yield* service.authorize({ providerID, method: 0 }).pipe(Effect.forkChild)
    yield* Effect.promise(() => observed)
    yield* Fiber.interrupt(starting)
    expect(settled).toBe(true)
    expect(Exit.isFailure(yield* service.callback({ providerID, method: 0, oauthState: "orphan-state" }).pipe(Effect.exit))).toBe(true)
    startup = async () => {}
    expect((yield* service.authorize({ providerID, method: 0 }))?.oauthState).toBeString()
  }).pipe(Effect.ensuring(Effect.sync(() => { startup = async () => {} })))
}))
it.instance("workspace disposal joins interrupted provider startup", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  const directory = (yield* TestInstance).directory
  let entered!: () => void; let settled = false
  const observed = new Promise<void>(resolve => { entered = resolve })
  startup = async () => { entered(); try { await authSleep(60000) } finally { settled = true } }
  yield* Effect.gen(function* () {
    const starting = yield* service.authorize({ providerID, method: 0 }).pipe(Effect.forkChild)
    yield* Effect.promise(() => observed)
    yield* Effect.promise(() => disposeInstance(directory))
    expect(settled).toBe(true)
    expect(Exit.isFailure(yield* Fiber.await(starting))).toBe(true)
  }).pipe(Effect.ensuring(Effect.sync(() => { startup = async () => {} })))
}))
test("uncertain provider cleanup quarantines the workspace instead of allowing replacement", async () => {
  let verifiedQuarantine = false
  const exit = await Effect.runPromise(Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  const directory = (yield* TestInstance).directory
  let entered!: () => void; let release!: () => void
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  callback = async () => { entered(); await gate; return { type: "success", key: "fixture-uncertain-key" } }
  yield* Effect.gen(function* () {
    const flow = yield* service.authorize({ providerID, method: 0 })
    const polling = yield* service.callback({ providerID, method: 0, oauthState: flow!.oauthState }).pipe(Effect.forkChild)
    yield* Effect.promise(() => observed)
    expect(yield* Effect.promise(() => disposeInstance(directory).then(() => false, () => true))).toBe(true)
    expect(() => assertDirectoryAvailable(directory)).toThrow("Workspace retirement")
    release(); expect(Exit.isFailure(yield* Fiber.await(polling))).toBe(true)
    expect(() => assertDirectoryAvailable(directory)).toThrow("Workspace retirement")
    verifiedQuarantine = true
  }).pipe(Effect.ensuring(Effect.sync(release)))
  }).pipe(withTmpdirInstance(), Effect.scoped, Effect.provide(layer), Effect.exit))
  expect(verifiedQuarantine).toBe(true)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Workspace cleanup failed")
})
it.instance("retiring provider OAuth cancels and joins an actual HTTP response body", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  const directory = (yield* TestInstance).directory
  let entered!: () => void; let settled = false
  const observed = new Promise<void>(resolve => { entered = resolve })
  const peer = Bun.serve({ port: 0, fetch: () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode("{"))
  } })) })
  callback = async () => {
    const response = await authFetch(peer.url)
    entered()
    try { await response.json(); return { type: "success", key: "fixture-http-key" } } finally { settled = true }
  }
  yield* Effect.gen(function* () {
    const flow = yield* service.authorize({ providerID, method: 0 })
    const polling = yield* service.callback({ providerID, method: 0, oauthState: flow!.oauthState }).pipe(Effect.forkChild)
    yield* Effect.promise(() => observed)
    yield* Effect.promise(() => disposeInstance(directory))
    expect(settled).toBe(true)
    expect(Exit.isFailure(yield* Fiber.await(polling))).toBe(true)
  }).pipe(Effect.ensuring(Effect.sync(() => { peer.stop(true) })))
}))
