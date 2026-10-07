import { NodeHttpServer } from "@effect/platform-node";
import { expect } from "bun:test";
import { Context, Effect, Layer, Option } from "effect";
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
} from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { MoveSession } from "@opencode-ai/core/control-plane/move-session";
import { Auth } from "../../src/auth";
import { Config } from "../../src/config/config";
import { Installation } from "../../src/installation";
import { ServerAuth } from "../../src/server/auth";
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api";
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control";
import { controlPlaneHandlers } from "../../src/server/routes/instance/httpapi/handlers/control-plane";
import { globalHandlers } from "../../src/server/routes/instance/httpapi/handlers/global";
import { authorizationLayer } from "../../src/server/routes/instance/httpapi/middleware/authorization";
import { schemaErrorLayer } from "../../src/server/routes/instance/httpapi/middleware/schema-error";
import { testEffect } from "../lib/effect";

const layer = HttpRouter.serve(
  HttpApiBuilder.layer(RootHttpApi).pipe(
    Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
    Layer.provide([authorizationLayer, schemaErrorLayer]),
    HttpRouter.provideRequest(
      Layer.succeedContext(Context.empty() as Context.Context<unknown>),
    ),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(Layer.mock(Auth.Service)({})),
  Layer.provide(
    Layer.mock(MoveSession.Service)({
      moveSession: () =>
        Effect.die("unexpected session transfer during selftest"),
    }),
  ),
  Layer.provide(Layer.mock(Config.Service)({})),
  Layer.provide(Layer.mock(Installation.Service)({})),
  Layer.provide(
    ServerAuth.Config.configLayer({
      password: Option.none(),
      username: "opencode",
    }),
  ),
);
const it = testEffect(layer);
it.live(
  "private runtime selftest routes reject default access and never start a tombstoned run",
  () =>
    Effect.gen(function* () {
      const previous = process.env.OPENCODE_TELEGRAM_RUNTIME_SELFTEST;
      try {
        delete process.env.OPENCODE_TELEGRAM_RUNTIME_SELFTEST;
        const request = (route: string, body: unknown) =>
          HttpClientRequest.post(route).pipe(
            HttpClientRequest.setBody(HttpBody.jsonUnsafe(body)),
            HttpClient.execute,
          );
        const denied = yield* request("/telegram/runtime-selftest", {
          profile: "baseline",
          runId: "http_selftest",
        });
        expect(denied.status).toBe(400);
        process.env.OPENCODE_TELEGRAM_RUNTIME_SELFTEST = "1";
        const invalid = yield* request("/telegram/runtime-selftest", {
          profile: "shell",
          runId: "http_selftest",
        });
        expect(invalid.status).toBe(400);
        const abort = yield* request(
          "/telegram/runtime-selftest/http_selftest/abort",
          {},
        );
        expect(abort.status).toBe(200);
        expect(yield* abort.json).toEqual({
          runId: "http_selftest",
          aborted: false,
          joined: true,
        });
        const late = yield* request("/telegram/runtime-selftest", {
          profile: "baseline",
          runId: "http_selftest",
        });
        expect(late.status).toBe(200);
        expect(yield* late.json).toMatchObject({
          runId: "http_selftest",
          profile: "baseline",
          joined: true,
          success: false,
          aborted: true,
        });
      } finally {
        if (previous === undefined)
          delete process.env.OPENCODE_TELEGRAM_RUNTIME_SELFTEST;
        else process.env.OPENCODE_TELEGRAM_RUNTIME_SELFTEST = previous;
      }
    }),
);
