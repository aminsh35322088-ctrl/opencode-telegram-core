import { expect, test } from "bun:test";
import { LayerNode } from "@opencode-ai/core/effect/layer-node";
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner";
import { Effect, Exit, Layer, Fiber } from "effect";
import { InstanceRef } from "../../src/effect/instance-ref";
import { InstanceState } from "../../src/effect/instance-state";
import {
  disposeInstance,
  registerDisposer,
} from "../../src/effect/instance-registry";
import { InstanceBootstrap } from "../../src/project/bootstrap";
import { InstanceStore } from "../../src/project/instance-store";
import { tmpdirScoped } from "../fixture/fixture";
import { testEffect } from "../lib/effect";
let bootstrapRun: Effect.Effect<void> = Effect.void;
const testLayer = LayerNode.compile(
  LayerNode.group([InstanceStore.node, CrossSpawnSpawner.node]),
  [
    [
      InstanceStore.bootstrapNode,
      Layer.succeed(InstanceBootstrap.Service, {
        run: Effect.suspend(() => bootstrapRun),
      }),
    ],
  ],
);
const it = testEffect(testLayer);
for (const operation of ["dispose", "reload"] as const) {
  test(`uncertain workspace ${operation} blocks replacement`, async () => {
    let asserted = false;
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped();
        const store = yield* InstanceStore.Service;
        const ctx = yield* store.load({ directory });
        const other = yield* tmpdirScoped();
        yield* store.load({ directory: other });
        let otherRetired = false;
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            registerDisposer(async (dir) => {
              if (dir === directory)
                throw new Error("owned service retirement uncertain");
              if (dir === other) otherRetired = true;
            }),
          ),
          (off) => Effect.sync(off),
        );
        expect(
          Exit.isFailure(
            yield* (
              operation === "dispose"
                ? store.dispose(ctx)
                : store.reload({ directory })
            ).pipe(Effect.exit),
          ),
        ).toBe(true);
        expect(
          Exit.isFailure(yield* store.load({ directory }).pipe(Effect.exit)),
        ).toBe(true);
        expect(
          Exit.isFailure(yield* store.reload({ directory }).pipe(Effect.exit)),
        ).toBe(true);
        expect(
          Exit.isFailure(yield* store.disposeAll().pipe(Effect.exit)),
        ).toBe(true);
        expect(
          Exit.isFailure(
            yield* store.disposeDirectory(directory).pipe(Effect.exit),
          ),
        ).toBe(true);
        expect(
          Exit.isFailure(yield* store.dispose(ctx).pipe(Effect.exit)),
        ).toBe(true);
        expect(otherRetired).toBe(true);
        asserted = true;
      }).pipe(Effect.scoped, Effect.provide(testLayer), Effect.exit),
    );
    expect(asserted).toBe(true);
    // Quarantine also survives layer shutdown; this intentional cleanup failure
    // must be observed rather than reported as a successful retirement.
    expect(Exit.isFailure(exit)).toBe(true);
  });
}
it.live("workspace load cannot regain authority during disposal", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped();
    const store = yield* InstanceStore.Service;
    const ctx = yield* store.load({ directory });
    let entered!: () => void;
    let release!: () => void;
    const closing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registerDisposer(async (dir) => {
          if (dir === directory) {
            entered();
            await gate;
          }
        }),
      ),
      (off) => Effect.sync(off),
    );
    const disposal = yield* store.dispose(ctx).pipe(Effect.forkChild);
    yield* Effect.gen(function* () {
      yield* Effect.promise(() => closing);
      expect(
        Exit.isFailure(yield* store.load({ directory }).pipe(Effect.exit)),
      ).toBe(true);
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          release();
          yield* Fiber.join(disposal);
        }),
      ),
    );
  }),
);
it.live("retired workspace context cannot reacquire service state", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped();
    const store = yield* InstanceStore.Service;
    const first = yield* store.load({ directory });
    const state = yield* InstanceState.make(() => Effect.succeed({}));
    yield* InstanceState.get(state).pipe(
      Effect.provideService(InstanceRef, first),
    );
    const second = yield* store.reload({ directory });
    yield* InstanceState.get(state).pipe(
      Effect.provideService(InstanceRef, second),
    );
    expect(
      Exit.isFailure(
        yield* InstanceState.get(state).pipe(
          Effect.provideService(InstanceRef, first),
          Effect.exit,
        ),
      ),
    ).toBe(true);
  }),
);

it.live("direct workspace retirement revokes the captured context", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped();
    const store = yield* InstanceStore.Service;
    const ctx = yield* store.load({ directory });
    const state = yield* InstanceState.make(() => Effect.succeed({}));
    yield* InstanceState.get(state).pipe(
      Effect.provideService(InstanceRef, ctx),
    );
    yield* Effect.promise(() => disposeInstance(directory));
    expect(
      Exit.isFailure(
        yield* InstanceState.get(state).pipe(
          Effect.provideService(InstanceRef, ctx),
          Effect.exit,
        ),
      ),
    ).toBe(true);
  }),
);

it.live("reload cannot return a workspace closing during bootstrap", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped();
    const store = yield* InstanceStore.Service;
    yield* store.load({ directory });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bootstrapRun = Effect.promise(async () => {
      entered();
      await gate;
    });
    const reload = yield* store.reload({ directory }).pipe(Effect.forkChild);
    yield* Effect.gen(function* () {
      yield* Effect.promise(() => started);
      const disposal = yield* store
        .disposeDirectory(directory)
        .pipe(Effect.forkChild({ startImmediately: true }));
      release();
      expect(Exit.isFailure(yield* Fiber.await(reload))).toBe(true);
      yield* Fiber.join(disposal);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          release();
          bootstrapRun = Effect.void;
        }),
      ),
    );
  }),
);
