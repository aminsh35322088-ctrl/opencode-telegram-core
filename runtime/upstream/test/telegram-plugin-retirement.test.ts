import { expect, test } from "bun:test"
import { Effect, Exit, Fiber } from "effect"
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
import { registerDisposer } from "../../src/effect/instance-registry"
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

test("workspace retirement owns an interrupted initializer and disposes its late hook", async () => {
  let entered!:()=>void, release!:()=>void, retiring!:()=>void, returned!:()=>void
  const started=new Promise<void>(resolve=>entered=resolve), gate=new Promise<void>(resolve=>release=resolve)
  const fenced=new Promise<void>(resolve=>retiring=resolve), rawReturned=new Promise<void>(resolve=>returned=resolve)
  const key="telegram-plugin-startup-fixture"
  const state={entered,gate,returned,retired:0}
  ;(globalThis as any)[key]=state
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const directory=yield* tmpdirScoped(), file=directory+'/late.ts'
      yield* Effect.promise(()=>Bun.write(file,`export default async()=>{const fixture=globalThis[${JSON.stringify(key)}];fixture.entered();await fixture.gate;fixture.returned();return {dispose(){fixture.retired++}}}`))
      cfg={plugin_origins:[{spec:pathToFileURL(file).href,source:directory+'/opencode.json',scope:'local'}]}
      const store=yield* InstanceStore.Service, ctx=yield* store.load({directory}), plugin=yield* Plugin.Service
      const starting=yield* plugin.list().pipe(Effect.provideService(InstanceRef,ctx),Effect.forkChild)
      yield* Effect.promise(()=>started)
      yield* Effect.acquireRelease(Effect.sync(()=>registerDisposer(async dir=>{if(dir===directory)retiring()})),off=>Effect.sync(off))
      const closing=yield* store.dispose(ctx).pipe(Effect.forkChild)
      yield* Effect.promise(()=>fenced)
      release()
      yield* Fiber.join(closing)
      yield* Effect.promise(()=>rawReturned)
      yield* Fiber.await(starting)
      expect(state.retired).toBe(1)
      expect(Exit.isFailure(yield* plugin.list().pipe(Effect.provideService(InstanceRef,ctx),Effect.exit))).toBe(true)
    }).pipe(Effect.scoped,Effect.provide(layer)))
  } finally {release();delete (globalThis as any)[key]}
})

test("uncertain plugin cleanup is bounded, starts all disposers, and never clears quarantine", async () => {
  let release!:()=>void, settled!:()=>void
  const gate=new Promise<void>(resolve=>release=resolve), complete=new Promise<void>(resolve=>settled=resolve)
  const key="telegram-plugin-uncertain-fixture", state={gate,settled,first:0,second:0}
  ;(globalThis as any)[key]=state
  let asserted=false
  try {
    const exit=await Effect.runPromise(Effect.gen(function* () {
      const directory=yield* tmpdirScoped(), file=directory+'/uncertain.ts'
      yield* Effect.promise(()=>Bun.write(file,`const fixture=globalThis[${JSON.stringify(key)}];export const first=async()=>({async dispose(){fixture.first++;await fixture.gate;fixture.settled()}});export const second=async()=>({dispose(){fixture.second++}})`))
      cfg={plugin_origins:[{spec:pathToFileURL(file).href,source:directory+'/opencode.json',scope:'local'}]}
      const store=yield* InstanceStore.Service, ctx=yield* store.load({directory}), plugin=yield* Plugin.Service
      yield* plugin.list().pipe(Effect.provideService(InstanceRef,ctx))
      expect(Exit.isFailure(yield* store.dispose(ctx).pipe(Effect.exit))).toBe(true)
      expect(state.first).toBe(1);expect(state.second).toBe(1)
      expect(Exit.isFailure(yield* store.load({directory}).pipe(Effect.exit))).toBe(true)
      release();yield* Effect.promise(()=>complete)
      expect(Exit.isFailure(yield* store.reload({directory}).pipe(Effect.exit))).toBe(true)
      expect(state.first).toBe(1);asserted=true
    }).pipe(Effect.scoped,Effect.provide(layer),Effect.exit))
    expect(asserted).toBe(true);expect(Exit.isFailure(exit)).toBe(true)
  } finally {release();delete (globalThis as any)[key]}
})

test("a blocked later initializer cannot prevent cleanup of an already loaded hook", async () => {
  let entered!:()=>void, release!:()=>void, returned!:()=>void, lateDisposed!:()=>void
  const started=new Promise<void>(resolve=>entered=resolve), gate=new Promise<void>(resolve=>release=resolve)
  const lateRetired=new Promise<void>(resolve=>lateDisposed=resolve)
  const complete=new Promise<void>(resolve=>returned=resolve), key="telegram-plugin-blocked-initializer"
  const state={entered,gate,returned,lateDisposed,first:0,late:0};(globalThis as any)[key]=state
  let asserted=false
  try {
    const exit=await Effect.runPromise(Effect.gen(function* () {
      const directory=yield* tmpdirScoped(), file=directory+'/blocked.ts'
      yield* Effect.promise(()=>Bun.write(file,`const fixture=globalThis[${JSON.stringify(key)}];export const first=async()=>({dispose(){fixture.first++}});export const second=async()=>{fixture.entered();await fixture.gate;fixture.returned();return {dispose(){fixture.late++;fixture.lateDisposed()}}}`))
      cfg={plugin_origins:[{spec:pathToFileURL(file).href,source:directory+'/opencode.json',scope:'local'}]}
      const store=yield* InstanceStore.Service, ctx=yield* store.load({directory}), plugin=yield* Plugin.Service
      const starting=yield* plugin.list().pipe(Effect.provideService(InstanceRef,ctx),Effect.forkChild)
      yield* Effect.promise(()=>started)
      expect(Exit.isFailure(yield* store.dispose(ctx).pipe(Effect.exit))).toBe(true)
      expect(state.first).toBe(1)
      expect(Exit.isFailure(yield* store.load({directory}).pipe(Effect.exit))).toBe(true)
      release();yield* Effect.promise(()=>complete);yield* Fiber.await(starting)
      yield* Effect.promise(()=>lateRetired)
      expect(state.first).toBe(1);expect(state.late).toBe(1);asserted=true
    }).pipe(Effect.scoped,Effect.provide(layer),Effect.exit))
    expect(asserted).toBe(true);expect(Exit.isFailure(exit)).toBe(true)
  } finally {release();delete (globalThis as any)[key]}
})
