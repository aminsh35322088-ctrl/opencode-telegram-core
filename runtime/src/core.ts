import { AtomicBindingStore } from "./runtime/atomic-binding-store.js";
import type { BindingIdentity, RunIdentity } from "./runtime/identity.js";
import { OutboundGateway, type OutboundSink } from "./runtime/outbound-gateway.js";
import { RunLivenessTracker } from "./runtime/liveness-tracker.js";
import { RunRegistry, type RuntimeExecutionInfo } from "./runtime/run-registry.js";
import { OpenCodeExecutionClient, type OpenCodeExecutionControlPort } from "./opencode/execution-client.js";
import { PerRunStuckDetector } from "./runtime/stuck-detector.js";
import { WorkerSupervisor, type WorkerFactory } from "./runtime/worker-supervisor.js";
import { WorkerOutboundGate } from "./ipc/worker-outbound-gate.js";
import { SessionEventRouter, type SessionParentLookup } from "./opencode/session-event-router.js";
import { OpenCodeTopicWorker, type OpenCodeTaskContext, type OpenCodeTaskOptions } from "./opencode/topic-worker.js";
import {
  RailwayResourceGovernor,
  type RailwayResourceAction,
  type RailwayResourcePolicy,
} from "./railway/resource-governor.js";
import {
  TelegramRichStreamController,
  type GenerationStoppedEvent,
  type NativeMarkdownStreamPort,
  type RichDraftRoute,
  type RichMessagePort,
} from "./telegram/rich-stream.js";
import {
  requireModelAdmission,
  type TelegramAdmissionPolicy,
  type TelegramRoute,
} from "./telegram/routes.js";

export interface TelegramNativeCoreOptions {
  readonly bindingStorePath: string;
  readonly workerFactory: WorkerFactory;
  readonly outboundSink: OutboundSink;
  readonly richMessagePort: RichMessagePort;
  readonly nativeMarkdownStreamPort: NativeMarkdownStreamPort;
  readonly abortRun: (run: RunIdentity, reason: "telegram_stop") => Promise<void>;
  readonly cleanupBinding?: (binding: BindingIdentity) => Promise<void>;
  readonly resolveSessionParent?: SessionParentLookup;
  readonly admissionPolicy: TelegramAdmissionPolicy;
  readonly railwayPolicy: RailwayResourcePolicy;
  readonly stuckRepeatThreshold?: number;
  readonly executionControl?: { readonly port: OpenCodeExecutionControlPort; readonly requestTimeoutMs: number };
}

export class TelegramNativeCore {
  readonly bindings: AtomicBindingStore;
  readonly runs = new RunRegistry();
  readonly workers: WorkerSupervisor;
  readonly outbound: OutboundGateway;
  readonly events: SessionEventRouter;
  readonly rich: TelegramRichStreamController;
  readonly liveness: RunLivenessTracker;
  readonly stuck: PerRunStuckDetector;
  readonly resources: RailwayResourceGovernor;
  readonly #execution: OpenCodeExecutionClient | undefined;

  private constructor(private readonly options: TelegramNativeCoreOptions) {
    this.bindings = new AtomicBindingStore(options.bindingStorePath);
    this.events = new SessionEventRouter(this.bindings.registry, this.runs, options.resolveSessionParent);
    this.workers = new WorkerSupervisor(options.workerFactory, {
      maxWorkers: options.railwayPolicy.maxWorkers,
    });
    this.outbound = new OutboundGateway(
      this.bindings.registry,
      this.runs,
      options.outboundSink,
    );
    this.rich = new TelegramRichStreamController(
      this.bindings.registry,
      this.runs,
      options.richMessagePort,
      options.abortRun,
      (run) => {
        this.finishRun(run);
      },
    );
    this.liveness = new RunLivenessTracker(this.runs);
    this.stuck = new PerRunStuckDetector(
      this.runs,
      options.stuckRepeatThreshold ?? 5,
    );
    this.resources = new RailwayResourceGovernor(options.railwayPolicy);
    if (options.executionControl) {
      this.#execution = new OpenCodeExecutionClient(this.runs, (run) => {
        const worker = this.workers.current(run);
        const target = worker instanceof OpenCodeTopicWorker ? worker.executionTarget(run) : null;
        if (!target || !this.bindings.registry.getExact(run) || !this.runs.accepts(run)) {
          throw new Error("Core run has no current owned execution target");
        }
        return {
          target: Object.freeze({ ...target, runId: run.runId }),
          isCurrent: () => this.bindings.registry.getExact(run) !== null && this.workers.current(run) === worker &&
            worker instanceof OpenCodeTopicWorker && worker.executionTarget(run) === target,
        };
      }, options.executionControl.port, options.executionControl.requestTimeoutMs);
    }
  }

  static async open(options: TelegramNativeCoreOptions): Promise<TelegramNativeCore> {
    const core = new TelegramNativeCore(options);
    await core.bindings.load();
    await core.reconcilePendingDeletes();
    return core;
  }

  async registerBinding(binding: BindingIdentity): Promise<void> {
    await this.bindings.register(binding);
  }

  async beginRun(bindingId: string, runId?: string): Promise<RunIdentity> {
    const binding = this.bindings.registry.getById(bindingId);
    if (!binding) throw new Error("cannot start run for unbound binding " + bindingId);

    let action = this.resourceAction();
    if (action === "EVICT_IDLE") {
      await this.workers.evictOldestIdle("railway_memory_pressure");
      action = this.resourceAction();
    }
    if (action === "EMERGENCY_SHUTDOWN" || action === "REJECT_NEW_WORK" || action === "EVICT_IDLE") {
      throw new Error("Railway resource budget rejects new work: " + action);
    }

    const worker = await this.workers.ensure(binding);
    if (
      !this.bindings.registry.getExact(binding) ||
      !this.workers.isCurrent(binding, worker)
    ) {
      await this.workers.stopIfCurrent(binding, worker, "stale_binding_admission");
      throw new Error("binding or worker changed during admission: " + bindingId);
    }
    const run = this.runs.startExclusive(binding, worker.generation, runId);
    this.liveness.start(run);
    return run;
  }

  finishRun(run: RunIdentity): boolean {
    this.rich.releaseRun(run);
    this.liveness.clear(run);
    this.stuck.clear(run);
    const finished = this.runs.finish(run);
    if (finished) this.workers.complete(run);
    return finished;
  }

  async dispatchTask<T>(
    run: RunIdentity,
    label: string,
    operation: (context: OpenCodeTaskContext) => Promise<T>,
    options: OpenCodeTaskOptions = {},
  ): Promise<T> {
    if (!this.runs.accepts(run)) throw new Error("Core run was fenced before task dispatch");
    const binding = this.bindings.registry.getExact(run);
    if (!binding) throw new Error("Core binding changed before task dispatch");
    const worker = await this.workers.ensure(binding);
    if (!this.runs.accepts(run) || !this.bindings.registry.getExact(run)) {
      throw new Error("Core run was fenced during worker acquisition");
    }
    if (!(worker instanceof OpenCodeTopicWorker) || worker.generation !== run.workerGeneration || !this.workers.isCurrent(binding, worker)) {
      throw new Error("Core worker changed before task dispatch");
    }
    return worker.executeTask(run, label, operation, { ...options, activity: this.runs.activity(run) });
  }

  async pauseRun(run: RunIdentity, signal?: AbortSignal): Promise<RuntimeExecutionInfo> {
    if (!this.#execution) throw new Error("runtime execution control port is not configured");
    return this.#execution.request(run, "pause", signal);
  }

  async resumeRun(run: RunIdentity, signal?: AbortSignal): Promise<RuntimeExecutionInfo> {
    if (!this.#execution) throw new Error("runtime execution control port is not configured");
    return this.#execution.request(run, "resume", signal);
  }

  async inspectExecution(run: RunIdentity, signal?: AbortSignal): Promise<RuntimeExecutionInfo> {
    if (!this.#execution) throw new Error("runtime execution control port is not configured");
    return this.#execution.request(run, "execution", signal);
  }

  async rotateBinding(
    bindingId: string,
    next: {
      readonly sessionId: string;
      readonly normalizedDirectory: string;
    },
  ): Promise<BindingIdentity> {
    const current = this.bindings.registry.getById(bindingId);
    if (!current) throw new Error("unknown binding " + bindingId);

    const replacement: BindingIdentity = {
      ...current,
      sessionId: next.sessionId,
      normalizedDirectory: next.normalizedDirectory,
      bindingGeneration: current.bindingGeneration + 1,
    };

    // Persist the new generation before old execution is allowed to stop/reuse.
    await this.bindings.replace(replacement, current.bindingGeneration);
    this.rich.releaseBinding(bindingId);
    this.runs.fence(bindingId);
    await this.workers.stop(bindingId, "binding_rotated");
    return replacement;
  }

  async revokeBinding(bindingId: string): Promise<void> {
    if (!this.bindings.registry.getById(bindingId)) return;
    // Persist DELETING + next generation first. A crash after this point can
    // never resurrect the route on restart.
    const tombstone = await this.bindings.beginDelete(bindingId);
    this.rich.releaseBinding(bindingId);
    this.runs.fence(bindingId);
    await this.workers.stop(bindingId, "binding_revoked");
    await this.options.cleanupBinding?.(tombstone);
    await this.bindings.completeDelete(bindingId);
  }

  async reconcilePendingDeletes(): Promise<void> {
    for (const tombstone of this.bindings.pendingDeletes()) {
      await this.options.cleanupBinding?.(tombstone);
      await this.bindings.completeDelete(tombstone.bindingId);
    }
  }

  workerOutboundGate(bindingId: string, workerGeneration: number): WorkerOutboundGate {
    return new WorkerOutboundGate(
      { bindingId, workerGeneration },
      this.outbound,
    );
  }

  async modelAllowed(route: TelegramRoute, operation: string): Promise<boolean> {
    return requireModelAdmission(this.options.admissionPolicy, { route, operation });
  }

  async streamMarkdown(
    run: RunIdentity,
    route: RichDraftRoute,
    chunks: AsyncIterable<string> | Iterable<string>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.rich.streamMarkdown(
      run,
      route,
      chunks,
      this.options.nativeMarkdownStreamPort,
      signal,
    );
  }

  async handleGenerationStopped(event: GenerationStoppedEvent): Promise<boolean> {
    return this.rich.stopped(event);
  }

  resourceAction(): RailwayResourceAction {
    return this.resources.evaluate(
      RailwayResourceGovernor.currentSnapshot(
        this.workers.size(),
        this.workers.idleCount(),
      ),
    );
  }

  async shutdown(): Promise<void> {
    for (const binding of this.bindings.registry.list()) {
      this.rich.releaseBinding(binding.bindingId);
      this.runs.fence(binding.bindingId);
    }
    await this.workers.stopAll("gateway_shutdown");
  }
}
