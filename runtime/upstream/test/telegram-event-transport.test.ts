import { expect, test } from "bun:test"
import { Effect, Layer, Queue, Stream } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control"
import { CurrentTelegramEpoch, CurrentTelegramExecution } from "@opencode-ai/core/telegram-execution-context"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { GlobalBus } from "../../src/bus/global"
import { SessionStatus } from "../../src/session/status"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, requestInDirectory } from "../server/httpapi-layer"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import { SessionID } from "../../src/session/schema"

test("generated SDK event schemas expose execution metadata", () => {
  const document = OpenApi.fromApi(PublicApi)
  const schemas = document.components?.schemas as Record<string, { properties?: Record<string, unknown> }>
  expect(schemas.EventSessionStatus?.properties?.metadata).toEqual({ type: "object" })
  expect(schemas.SyncEventSessionUpdated?.properties?.syncEvent).toMatchObject({
    properties: { metadata: { type: "object" } },
  })
})

const it = testEffect(httpApiLayer.pipe(Layer.provideMerge(LayerNode.compile(EventV2Bridge.node))))

it.instance(
  "SSE and global events preserve the original execution owner",
  () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const events = yield* EventV2Bridge.Service
      const response = yield* requestInDirectory(EventPaths.event, directory)
      const queue = yield* Queue.unbounded<Uint8Array>()
      yield* response.stream.pipe(
        Stream.runForEach((value) => Queue.offer(queue, value)),
        Effect.forkScoped,
      )
      yield* Queue.take(queue).pipe(Effect.timeout("5 seconds")) // server.connected
      const control = new SessionExecutionControl()
      const run = control.start({ sessionId: "ses_transport", runId: "original-run", directory })
      const expected = {
        version: 1,
        root: { sessionId: "ses_transport", runId: "original-run", directory },
        producer: { sessionId: "ses_transport", runId: "original-run", directory },
        epoch: 1,
      }
      let global: unknown
      const listener = (event: { payload: { type?: string; metadata?: Record<string, unknown> } }) => {
        if (event.payload.type === "session.status") global = event.payload.metadata?.telegramExecution
      }
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          GlobalBus.off("event", listener)
          control.dispose()
        }),
      )
      yield* events
        .publish(SessionStatus.Event.Status, { sessionID: SessionID.make("ses_transport"), status: { type: "busy" } })
        .pipe(Effect.provideService(CurrentTelegramExecution, run), Effect.provideService(CurrentTelegramEpoch, 1))
      control.close(run.owner)
      control.start({ ...run.owner, runId: "replacement-run" })
      const chunk = yield* Queue.take(queue).pipe(Effect.timeout("5 seconds"))
      const message = JSON.parse(new TextDecoder().decode(chunk).replace(/^data: /, ""))
      expect(message.type).toBe("session.status")
      expect(message.metadata?.telegramExecution).toEqual(expected)
      expect(global).toEqual(expected)
    }),
  { git: true, config: { formatter: false, lsp: false } },
)
