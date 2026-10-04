import { expect } from "bun:test"
import { Effect, Fiber, Exit } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { MCP } from "../../src/mcp"
import { McpAuth } from "../../src/mcp/auth"
import { McpOAuthPendingProvider } from "../../src/mcp/oauth-provider"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeInstance } from "../../src/effect/instance-registry"
import { TestInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { oauthPeer } from "./telegram-mcp-oauth.fixture"
const it = testEffect(LayerNode.compile(LayerNode.group([MCP.node, McpAuth.node, CrossSpawnSpawner.node])))
const remote = (url: string) => ({ type: "remote" as const, url, enabled: false, timeout: 5000 })
const stopCallback = Effect.addFinalizer(() => Effect.promise(() => McpOAuthCallback.stop()))
it.instance("OAuth handshakes do not share PKCE or nonce state", () => Effect.gen(function* () {
  const auth = yield* McpAuth.Service
  const name = crypto.randomUUID()
  const a = new McpOAuthPendingProvider(name, "https://example.test/mcp", {}, { onRedirect() {} }, auth)
  const b = new McpOAuthPendingProvider(name, "https://example.test/mcp", {}, { onRedirect() {} }, auth)
  yield* Effect.promise(async () => {
    await a.saveState("first-state"); await a.saveCodeVerifier("first-verifier")
    await b.saveState("second-state"); await b.saveCodeVerifier("second-verifier")
    expect(await a.state()).toBe("first-state")
    expect(await a.codeVerifier()).toBe("first-verifier")
  })
  expect(yield* auth.get(name)).toBeUndefined()
}))
it.instance("same-name OAuth flows complete only in their originating workspace", () => Effect.gen(function* () {
  yield* stopCallback
  const a = yield* oauthPeer(); const b = yield* oauthPeer()
  const mcp = yield* MCP.Service; const store = yield* InstanceStore.Service
  const name = crypto.randomUUID(); const other = yield* tmpdirScoped()
  yield* mcp.add(name, remote(a.url))
  const first = yield* mcp.startAuth(name); a.authorize(first.authorizationUrl, "first-code")
  const second = yield* store.provide({ directory: other }, Effect.gen(function* () {
    yield* mcp.add(name, remote(b.url)); return yield* mcp.startAuth(name)
  }))
  b.authorize(second.authorizationUrl, "second-code")
  expect((yield* mcp.finishAuth(name, "first-code", first.oauthState)).status).toBe("connected")
  expect(a.exchanges).toEqual(["first-code"]); expect(b.exchanges).toEqual([])
  expect((yield* store.provide({ directory: other }, mcp.finishAuth(name, "second-code", second.oauthState))).status).toBe("connected")
}))
it.instance("retiring one workspace preserves another workspace's same-name OAuth flow", () => Effect.gen(function* () {
  yield* stopCallback
  const a = yield* oauthPeer(); const b = yield* oauthPeer()
  const mcp = yield* MCP.Service; const store = yield* InstanceStore.Service
  const name = crypto.randomUUID(); const other = yield* tmpdirScoped()
  yield* mcp.add(name, remote(a.url)); yield* mcp.startAuth(name)
  const flow = yield* store.provide({ directory: other }, Effect.gen(function* () {
    yield* mcp.add(name, remote(b.url)); return yield* mcp.startAuth(name)
  }))
  b.authorize(flow.authorizationUrl, "surviving-code")
  const directory = (yield* TestInstance).directory
  yield* Effect.promise(() => disposeInstance(directory))
  expect((yield* store.provide({ directory: other }, mcp.finishAuth(name, "surviving-code", flow.oauthState))).status).toBe("connected")
}))
it.instance("stale or missing OAuth callback state cannot start token exchange", () => Effect.gen(function* () {
  yield* stopCallback
  const peer = yield* oauthPeer(); const mcp = yield* MCP.Service; const name = crypto.randomUUID()
  yield* mcp.add(name, remote(peer.url))
  const old = yield* mcp.startAuth(name); peer.authorize(old.authorizationUrl, "old-code")
  const next = yield* mcp.startAuth(name); peer.authorize(next.authorizationUrl, "current-code")
  expect((yield* mcp.finishAuth(name, "current-code")).status).toBe("failed")
  expect((yield* mcp.finishAuth(name, "old-code", old.oauthState)).status).toBe("failed")
  expect(peer.exchanges).toEqual([])
  expect((yield* mcp.finishAuth(name, "current-code", next.oauthState)).status).toBe("connected")
}))
it.instance("retired OAuth completion cannot persist delayed credentials", () => Effect.gen(function* () {
  yield* stopCallback
  const peer = yield* oauthPeer(); const mcp = yield* MCP.Service; const auth = yield* McpAuth.Service
  const name = crypto.randomUUID(); const directory = (yield* TestInstance).directory
  yield* mcp.add(name, remote(peer.url))
  const flow = yield* mcp.startAuth(name); peer.authorize(flow.authorizationUrl, "late-code")
  let entered!: () => void; let release!: () => void
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  peer.blockToken(gate, entered)
  const completion = yield* mcp.finishAuth(name, "late-code", flow.oauthState).pipe(Effect.forkChild)
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => observed)
    yield* Effect.promise(() => disposeInstance(directory))
    release()
    yield* Fiber.await(completion)
    expect((yield* auth.get(name))?.tokens).toBeUndefined()
  }).pipe(Effect.ensuring(Effect.sync(release)))
}))
it.instance("interrupted token exchange retires its flow before another callback can reuse it", () => Effect.gen(function* () {
  yield* stopCallback
  const peer = yield* oauthPeer(); const mcp = yield* MCP.Service; const auth = yield* McpAuth.Service
  const name = crypto.randomUUID()
  yield* mcp.add(name, remote(peer.url))
  const flow = yield* mcp.startAuth(name); peer.authorize(flow.authorizationUrl, "interrupted-code")
  let entered!: () => void; let release!: () => void
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  peer.blockToken(gate, entered)
  const completion = yield* mcp.finishAuth(name, "interrupted-code", flow.oauthState).pipe(Effect.forkChild)
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => observed)
    yield* Fiber.interrupt(completion)
    release()
    expect((yield* mcp.finishAuth(name, "interrupted-code", flow.oauthState)).status).toBe("failed")
    expect(peer.exchanges).toEqual(["interrupted-code"])
    expect((yield* auth.get(name))?.tokens).toBeUndefined()
  }).pipe(Effect.ensuring(Effect.sync(release)))
}))
it.instance("interrupted OAuth startup is retired before same-name replacement starts", () => Effect.gen(function* () {
  yield* stopCallback
  const peer = yield* oauthPeer(); const mcp = yield* MCP.Service; const auth = yield* McpAuth.Service
  const name = crypto.randomUUID()
  yield* mcp.add(name, remote(peer.url))
  let entered!: () => void; let release!: () => void
  const observed = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  peer.blockRegistration(gate, entered)
  const startup = yield* mcp.startAuth(name).pipe(Effect.forkChild)
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => observed)
    yield* Fiber.interrupt(startup)
    expect(Exit.isFailure(yield* Fiber.await(startup))).toBe(true)
    release()
    const replacement = yield* mcp.startAuth(name)
    peer.authorize(replacement.authorizationUrl, "replacement-code")
    expect((yield* mcp.finishAuth(name, "replacement-code", replacement.oauthState)).status).toBe("connected")
    expect((yield* auth.get(name))?.tokens?.accessToken).toBe("fixture-token")
  }).pipe(Effect.ensuring(Effect.sync(release)))
}))
