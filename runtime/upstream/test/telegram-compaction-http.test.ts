import { afterEach, expect, mock } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"

const it = testEffect(Layer.mergeAll(LayerNode.compile(Session.node), httpApiLayer))
afterEach(async () => { mock.restore(); await disposeAllInstances() })
it.instance("async compaction accepts before provider failure and retains the native compaction marker", () => Effect.gen(function* () {
  const test = yield* TestInstance
  const session = yield* Effect.acquireRelease(Session.use.create({}), created => Session.use.remove(created.id).pipe(Effect.ignore))
  const response = yield* requestInDirectory(`/session/${session.id}/summarize`, test.directory, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerID: "missing_compaction_fixture", modelID: "missing", async: true }),
  })
  expect(response.status).toBe(200)
  expect(yield* response.json).toBe(true)
  const messages = yield* Session.Service.use(svc => svc.messages({ sessionID: session.id }))
  expect(messages.some(message => message.parts.some(part => part.type === "compaction"))).toBe(true)
}), { git: true })
