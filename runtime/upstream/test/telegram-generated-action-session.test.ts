import { expect } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { SessionTools } from "../../src/session/tools";
import { ToolRegistry } from "../../src/tool/registry";
import { Plugin } from "../../src/plugin";
import { Permission } from "../../src/permission";
import { MCP } from "../../src/mcp";
import { Truncate } from "../../src/tool/truncate";
import { RuntimeFlags } from "../../src/effect/runtime-flags";
import { SessionID, MessageID } from "../../src/session/schema";
import { SessionExecutionControl } from "@opencode-ai/core/session-execution-control";
import {
  CurrentTelegramExecution,
  CurrentTelegramEpoch,
} from "@opencode-ai/core/telegram-execution-context";
import { testEffect } from "../lib/effect";

const sessionID = SessionID.make("ses_generated");
const asks: Array<any> = [];
const targetCalls: Array<any> = [];
const mcpCalls: Array<any> = [];
const mcpClient = {
  getServerCapabilities: () => ({}),
  callTool: async (args: any, _schema: any, options: any) => {
    mcpCalls.push({ args, signal: options.signal });
    return { content: [{ type: "text", text: "MCP result" }] };
  },
};
let rejectPermission = false;
const layer = Layer.mergeAll(
  Layer.succeed(
    Plugin.Service,
    Plugin.Service.of({
      init: () => Effect.void,
      list: () => Effect.succeed([]),
      trigger: (_name: any, _input: any, output: any) => Effect.succeed(output),
    }),
  ),
  Layer.succeed(
    Permission.Service,
    Permission.Service.of({
      ask: (request: any) =>
        Effect.sync(() => {
          asks.push(request);
          if (rejectPermission) throw new Error("Permission rejected");
        }),
      reply: () => Effect.void,
      list: () => Effect.succeed([]),
    }),
  ),
  Layer.succeed(
    MCP.Service,
    MCP.Service.of({
      tools: () =>
        Effect.succeed({
          server_delete_tool: {
            def: {
              name: "delete_tool",
              inputSchema: {
                type: "object",
                properties: { resource: { type: "string" } },
              },
            },
            client: mcpClient,
            timeout: 1000,
          },
        }),
      clients: () => Effect.succeed({ server: mcpClient }),
    } as any),
  ),
  Layer.succeed(
    Truncate.Service,
    Truncate.Service.of({
      cleanup: () => Effect.void,
      write: () => Effect.succeed("out"),
      output: (text: string) =>
        Effect.succeed({ content: text, truncated: false }),
      limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 50000 }),
    }),
  ),
  RuntimeFlags.layer(),
  Layer.succeed(
    ToolRegistry.Service,
    ToolRegistry.Service.of({
      ids: () => Effect.succeed([]),
      all: () => Effect.succeed([]),
      named: () => Effect.die("unused"),
      tools: () =>
        Effect.succeed([
          {
            id: "actions",
            description: "Invoke",
            parameters: Schema.Unknown,
            jsonSchema: { type: "object" },
            execute: (args: any, ctx: any) =>
              Effect.promise(() =>
                ctx.extra.generatedActionInvoke(args.id, args.arguments),
              ),
          },
          {
            id: "probe",
            description: "Captured target",
            parameters: Schema.Unknown,
            jsonSchema: { type: "object" },
            execute: (args: any, ctx: any) =>
              Effect.sync(() => {
                targetCalls.push({
                  args,
                  sessionID: ctx.sessionID,
                  messageID: ctx.messageID,
                  signal: ctx.abort,
                });
                return {
                  title: "probe",
                  output: JSON.stringify(args),
                  metadata: { target: true },
                };
              }),
          },
        ] as any),
    }),
  ),
);
const it = testEffect(layer);
it.effect(
  "generated delegation uses the real SessionTools map and captured permission/session/abort",
  () =>
    Effect.gen(function* () {
      asks.length = 0;
      targetCalls.length = 0;
      mcpCalls.length = 0;
      rejectPermission = false;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 4098,
        async fetch(request) {
          const value: any = await request.json();
          expect(value.sessionId).toBe(sessionID);
          expect(value.action).toBe("actions.resolve");
          if (value.payload.id === "server.delete")
            return Response.json({
              ok: true,
              result: {
                plan: {
                  revision: 7,
                  id: "server.delete",
                  risk: "destructive",
                  invocation: {
                    kind: "mcp-tool",
                    server: "server",
                    tool: "delete_tool",
                  },
                },
              },
            });
          return Response.json({
            ok: true,
            result: {
              plan: {
                revision: 7,
                id: "example.probe",
                risk: "write",
                invocation: {
                  kind: "action-tool",
                  tool: "probe",
                  actionArgument: "action",
                  actionValue: "read",
                  arguments: { fixed: "approved" },
                },
              },
            },
          });
        },
      });
      try {
        const control = new SessionExecutionControl();
        const execution = control.start({
          sessionId: sessionID,
          runId: "run",
          directory: "/workspace",
        });
        const messageID = MessageID.ascending();
        const messages: any[] = [];
        const tools = yield* SessionTools.resolve({
          agent: {
            name: "build",
            mode: "primary",
            options: {},
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          },
          model: { providerID: "test", api: { id: "test-model" } } as any,
          session: { id: sessionID, permission: [] } as any,
          processor: {
            message: { id: messageID },
            updateToolCall: () => Effect.void,
            completeToolCall: () => Effect.void,
          } as any,
          bypassAgentCheck: false,
          messages,
          promptOps: {} as any,
        }).pipe(
          Effect.provideService(CurrentTelegramExecution, execution),
          Effect.provideService(CurrentTelegramEpoch, execution.epoch),
        );
        const signal = new AbortController().signal;
        const execute = tools.actions.execute!;
        const options = {
          toolCallId: "call",
          abortSignal: signal,
          messages: [],
        };
        const result: any = yield* Effect.promise(() =>
          execute(
            { id: "example.probe", arguments: { input: "hello" } },
            options,
          ),
        );
        expect(targetCalls).toEqual([
          {
            args: { input: "hello", fixed: "approved", action: "read" },
            sessionID,
            messageID,
            signal,
          },
        ]);
        expect(asks[0].metadata).toEqual({
          generatedAction: "example.probe",
          risk: "write",
          revision: 7,
        });
        expect(result.metadata.generatedActionRisk).toBe("write");
        const mcpResult: any = yield* Effect.promise(() =>
          execute(
            { id: "server.delete", arguments: { resource: "sample" } },
            options,
          ),
        );
        expect(mcpCalls).toEqual([
          {
            args: { name: "delete_tool", arguments: { resource: "sample" } },
            signal,
          },
        ]);
        expect(mcpResult.output).toBe("MCP result");
        expect(mcpResult.metadata.generatedActionRisk).toBe("destructive");
        expect(
          asks.some(
            (request) =>
              request.permission === "server_delete_tool" &&
              request.metadata.risk === "destructive",
          ),
        ).toBe(true);
        messages.push({
          info: { role: "user", tools: { probe: false } },
          parts: [],
        });
        yield* Effect.promise(async () => {
          await expect(
            execute({ id: "example.probe", arguments: {} }, options),
          ).rejects.toThrow("disabled");
        });
        expect(targetCalls.length).toBe(1);
        messages.length = 0;
        rejectPermission = true;
        yield* Effect.promise(async () => {
          await expect(
            execute({ id: "example.probe", arguments: {} }, options),
          ).rejects.toThrow("Permission rejected");
        });
        expect(targetCalls.length).toBe(1);
        rejectPermission = false;
        control.close(execution.owner);
        yield* Effect.promise(async () => {
          await expect(
            execute({ id: "example.probe", arguments: {} }, options),
          ).rejects.toThrow();
        });
        expect(targetCalls.length).toBe(1);
      } finally {
        server.stop(true);
      }
    }),
);
