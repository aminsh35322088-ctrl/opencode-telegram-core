import { NodeHttpServer } from "@effect/platform-node";
import { expect } from "bun:test";
import { Context, Effect, Layer, Option } from "effect";
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
} from "effect/unstable/http";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { Auth } from "../../src/auth";
import { ServerAuth } from "../../src/server/auth";
import { RootHttpApi } from "../../src/server/routes/instance/httpapi/api";
import { controlHandlers } from "../../src/server/routes/instance/httpapi/handlers/control";
import { ControlApi } from "../../src/server/routes/instance/httpapi/groups/control";
import {
  Authorization,
  authorizationLayer,
} from "../../src/server/routes/instance/httpapi/middleware/authorization";
import {
  SchemaErrorMiddleware,
  schemaErrorLayer,
} from "../../src/server/routes/instance/httpapi/middleware/schema-error";
import { testEffect } from "../lib/effect";

// Exercise the real control handler and schema without unrelated root API groups.
const selftestApi = HttpApi.make("opencode-root")
  .addHttpApi(ControlApi)
  .middleware(SchemaErrorMiddleware)
  .middleware(Authorization);
const layer = HttpRouter.serve(
  HttpApiBuilder.layer(selftestApi).pipe(
    Layer.provide(controlHandlers),
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
      expect(
        RootHttpApi.groups.control.endpoints.runtimeSelftest,
      ).toBeDefined();
      expect(
        RootHttpApi.groups.control.endpoints.runtimeSelftestAbort,
      ).toBeDefined();
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
