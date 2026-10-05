// Diagnostic: copy into materialized packages/opencode/test/telegram/ and run bun test ./test/telegram/telegram-plugin-retirement.probe.ts. Not a passing release gate.
import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceRef } from "../../src/effect/instance-ref"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Plugin } from "../../src/plugin/index"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { TestConfig } from "../fixture/config"
import { tmpdirScoped } from "../fixture/fixture"
import { pathToFileURL } from "node:url"
import { Layer } from "effect"
let cfg: ReturnType<Config.Interface["get"]> extends Effect.Effect<infer A, any, any> ? A : never = {}
const layer = LayerNode.compile(LayerNode.group([InstanceStore.node, Plugin.node, CrossSpawnSpawner.node]), [
  [InstanceStore.bootstrapNode, Layer.succeed(InstanceBootstrap.Service, {run:Effect.void})],
  [Config.node, TestConfig.layer({get:()=>Effect.sync(()=>cfg)})],
  [RuntimeFlags.node, RuntimeFlags.layer({disableDefaultPlugins:true})],
])
test("failed plugin retirement is quarantined and every dispose hook is attempted", async () => {
  let asserted = false
  const exit = await Effect.runPromise(Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const mark = directory + '/second-retired'; const first = directory + '/first.ts', second = directory + '/second.ts'
    yield* Effect.promise(async () => {
      await Bun.write(first, `export default async()=>({dispose(){throw Error('plugin retirement uncertain')}})`)
      await Bun.write(second, `export default async()=>({async dispose(){await Bun.write(${JSON.stringify(mark)},'retired')}})`)
    })
    cfg = {plugin_origins:[first,second].map(file=>({spec:pathToFileURL(file).href,source:directory+'/opencode.json',scope:'local'}))}
    const store = yield* InstanceStore.Service; const ctx = yield* store.load({directory})
    const plugin = yield* Plugin.Service
    const hooks = yield* plugin.list().pipe(Effect.provideService(InstanceRef,ctx));expect(hooks.length).toBe(2)
    expect(Exit.isFailure(yield* store.dispose(ctx).pipe(Effect.exit))).toBe(true)
    expect(yield* Effect.promise(()=>Bun.file(mark).exists())).toBe(true)
    expect(Exit.isFailure(yield* store.load({directory}).pipe(Effect.exit))).toBe(true)
    asserted = true
  }).pipe(Effect.scoped,Effect.provide(layer),Effect.exit))
  expect(asserted).toBe(true);expect(Exit.isFailure(exit)).toBe(true)
})
