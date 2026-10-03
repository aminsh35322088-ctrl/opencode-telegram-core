import { expect, spyOn, test } from "bun:test"
import path from "node:path"
import { readFile } from "node:fs/promises"
import { Effect, Exit, Fiber } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LSP } from "../../src/lsp/lsp"
import { LSPClient } from "../../src/lsp/client"
import * as LSPServer from "../../src/lsp/server"
import { spawn as launchLsp } from "../../src/lsp/launch"
import { Process } from "../../src/util/process"
import { telegramProcessBudgetSnapshot } from "@opencode-ai/core/telegram-process-budget"
import { disposeInstance } from "../../src/effect/instance-registry"
import { TestInstance, withTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const testLayer = LayerNode.compile(LSP.node)
const it = testEffect(testLayer)
it.instance("workspace disposal joins an LSP process still initializing", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const directory = (yield* TestInstance).directory
  const lsp = yield* LSP.Service
  let child: Process.Child | undefined
  let entered!: () => void
  const initialized = new Promise<void>((resolve) => { entered = resolve })
  const init = spyOn(LSPClient, "create").mockImplementation(async (input) => {
    child = input.server.process
    entered()
    await child.exited
    throw new Error("initializing transport closed")
  })
  const pending = yield* lsp.touchFile(path.join(directory, "pending.coreprobe")).pipe(Effect.forkChild)
  let aliveAfterDisposal = false
  yield* Effect.gen(function* () {
    yield* Effect.promise(() => initialized)
    yield* Effect.promise(() => disposeInstance(directory))
    aliveAfterDisposal = yield* Effect.promise(async () => {
      try { await readFile(`/proc/${child!.pid}/stat`); return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
    })
  }).pipe(Effect.ensuring(Effect.gen(function* () {
    if (child) yield* Effect.promise(() => Process.stop(child!))
    yield* Fiber.await(pending)
    yield* Effect.sync(() => init.mockRestore())
  })))
  expect(aliveAfterDisposal).toBe(false)
}), { config: { lsp: { coreprobe: { command: ["/bin/sleep", "60"], extensions: [".coreprobe"] } } } })

it.instance("workspace disposal retires a late LSP acquisition without publishing it", () => Effect.gen(function* () {
  if (process.platform !== "linux") return
  const directory = (yield* TestInstance).directory
  const lsp = yield* LSP.Service
  let acquired!: () => void
  let release!: () => void
  let closing!: () => void
  const acquiring = new Promise<void>((resolve) => { acquired = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  const disposing = new Promise<void>((resolve) => { closing = resolve })
  const children: Process.Child[] = []
  let published = 0
  const root = spyOn(LSPServer.Typescript, "root").mockImplementation(async (file) => path.dirname(file))
  const spawn = spyOn(LSPServer.Typescript, "spawn").mockImplementation(async () => {
    const child = launchLsp("/bin/sleep", ["60"])
    children.push(child)
    if (children.length === 2) {
      acquired()
      await released
    }
    return { process: child }
  })
  const init = spyOn(LSPClient, "create").mockImplementation(async (input) => {
    published++
    return {
      root: input.root, serverID: input.serverID,
      notify: { open: async () => 1 },
      shutdown: async () => { closing(); await Process.stop(input.server.process) },
    } as unknown as LSPClient.Info
  })
  let remaining: boolean[] = []
  yield* Effect.gen(function* () {
    yield* lsp.touchFile(path.join(directory, "first", "file.ts"))
    const pending = yield* lsp.touchFile(path.join(directory, "second", "file.ts")).pipe(Effect.forkChild)
    yield* Effect.promise(() => acquiring)
    const disposal = yield* Effect.promise(() => disposeInstance(directory)).pipe(Effect.forkChild)
    // The first client's shutdown is a causal witness that teardown has begun.
    yield* Effect.promise(() => disposing)
    yield* Effect.sync(release)
    yield* Fiber.join(pending)
    yield* Fiber.join(disposal)
    remaining = yield* Effect.promise(() => Promise.all(children.map(async (child) => {
      try { await readFile(`/proc/${child.pid}/stat`); return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
    })))
  }).pipe(Effect.ensuring(Effect.promise(async () => {
    release()
    await Promise.all(children.map((child) => Process.stop(child)))
    init.mockRestore(); spawn.mockRestore(); root.mockRestore()
  })))
  expect(published).toBe(1)
  expect(remaining).toEqual([false, false])
}), { config: { lsp: true } })

test("workspace disposal bounds stalled startup and owns its pre-handle process", async () => {
  if (process.platform !== "linux") return;
  let asserted = false;
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const directory = (yield* TestInstance).directory;
      const lsp = yield* LSP.Service;
      const previousFlag = process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET;
      process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = "1";
      const count = telegramProcessBudgetSnapshot().activeCount;
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let child: ReturnType<typeof launchLsp> | undefined;
      let launches = 0;
      let lateLaunchRejected = false;
      const root = spyOn(LSPServer.Typescript, "root").mockResolvedValue(
        directory,
      );
      const spawn = spyOn(LSPServer.Typescript, "spawn").mockImplementation(
        async () => {
          launches++;
          child = launchLsp("/bin/sleep", ["60"]);
          entered();
          await gate;
          try {
            launchLsp("/bin/sleep", ["60"]);
          } catch {
            lateLaunchRejected = true;
          }
          return { process: child };
        },
      );
      const pending = yield* lsp
        .touchFile(path.join(directory, "file.ts"))
        .pipe(Effect.forkChild);
      let bounded = false;
      let alive = false;
      let retainedCount = 0;
      yield* Effect.gen(function* () {
        yield* Effect.promise(() => started);
        bounded = yield* Effect.promise(async () => {
          let deadline: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              disposeInstance(directory).then(
                () => false,
                () => true,
              ),
              new Promise<false>((resolve) => {
                deadline = setTimeout(() => resolve(false), 7000);
              }),
            ]);
          } finally {
            clearTimeout(deadline);
          }
        });
        alive = yield* Effect.promise(async () => {
          try {
            await readFile(`/proc/${child!.pid}/stat`);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
              return false;
            throw error;
          }
        });
        retainedCount = telegramProcessBudgetSnapshot().activeCount;
        // A new workspace cannot start another acquisition while cleanup is uncertain.
        expect(
          Exit.isFailure(
            yield* lsp
              .touchFile(path.join(directory, "replacement.ts"))
              .pipe(Effect.exit),
          ),
        ).toBe(true);
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.sync(release);
            if (child) yield* Effect.promise(() => Process.stop(child!));
            yield* Fiber.await(pending);
            yield* Effect.sync(() => {
              spawn.mockRestore();
              root.mockRestore();
              if (previousFlag === undefined)
                delete process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET;
              else process.env.OPENCODE_TELEGRAM_PROCESS_BUDGET = previousFlag;
            });
          }),
        ),
      );
      expect(bounded).toBe(true);
      expect(alive).toBe(false);
      expect(retainedCount).toBe(count + 1);
      expect(launches).toBe(1);
      expect(lateLaunchRejected).toBe(true);
      expect(telegramProcessBudgetSnapshot().activeCount).toBe(count);
      asserted = true;
    }).pipe(
      withTmpdirInstance({ config: { lsp: true } }),
      Effect.scoped,
      Effect.provide(testLayer),
      Effect.exit,
    ),
  );
  expect(asserted).toBe(true);
  expect(Exit.isFailure(exit)).toBe(true);
});
