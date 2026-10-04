import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderAuth } from "../../src/provider/auth"
import { Auth } from "../../src/auth"
import { Plugin } from "../../src/plugin"
import { disposeInstance } from "../../src/effect/instance-registry"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

let callback: () => Promise<{ type: "success"; key: string }>
const plugin = Layer.succeed(Plugin.Service, Plugin.Service.of({
  init: () => Effect.void,
  trigger: (_name, _input, output) => Effect.succeed(output),
  list: () => Effect.succeed([{ auth: {
    provider: "telegram-provider-fixture",
    methods: [{ type: "oauth", label: "controlled fixture", authorize: async () => ({
      url: "https://example.test/authorize", method: "auto", instructions: "fixture",
      callback: () => callback(),
    }) }],
  } }]),
}))
const it = testEffect(LayerNode.compile(LayerNode.group([ProviderAuth.node, Auth.node]), [[Plugin.node, plugin]]))
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
  yield* service.authorize({ providerID, method: 0 })
  const completion = yield* service.callback({ providerID, method: 0 }).pipe(Effect.forkChild)
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => observed)
    yield* Effect.promise(() => disposeInstance(directory))
    release()
    yield* Fiber.await(completion)
    expect(yield* auth.get(providerID)).toBeUndefined()
  }).pipe(Effect.ensuring(Effect.sync(release)), Effect.ensuring(auth.remove(providerID)))
}))
it.instance("completed provider OAuth callback cannot replay its credential exchange", () => Effect.gen(function* () {
  const service = yield* ProviderAuth.Service
  const auth = yield* Auth.Service
  const providerID = ProviderV2.ID.make("telegram-provider-fixture")
  let exchanges = 0
  callback = async () => { exchanges++; return { type: "success", key: "fixture-replay-key" } }
  yield* Effect.gen(function* () {
    yield* service.authorize({ providerID, method: 0 })
    yield* service.callback({ providerID, method: 0 })
    yield* service.callback({ providerID, method: 0 }).pipe(Effect.exit)
    expect(exchanges).toBe(1)
  }).pipe(Effect.ensuring(auth.remove(providerID)))
}))
