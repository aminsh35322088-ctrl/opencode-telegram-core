import type { BindingRegistry } from "../runtime/binding-registry.js";
import type { BindingIdentity, RunIdentity } from "../runtime/identity.js";
import type { RunRegistry } from "../runtime/run-registry.js";
import type { WorkerSupervisor } from "../runtime/worker-supervisor.js";

export interface ScheduledTaskRecord {
  readonly taskId: string;
  readonly executionId: string;
  readonly bindingId: string;
  readonly botId: string;
  readonly chatId: number;
  readonly threadId: number;
  readonly sessionId: string;
  readonly normalizedDirectory: string;
  readonly bindingGeneration: number;
  readonly payload: unknown;
}

export interface ScheduledTaskExecutionLedger {
  claim(executionId: string): Promise<boolean>;
  complete(executionId: string): Promise<void>;
  release(executionId: string): Promise<void>;
}

export interface ScheduledTaskPort {
  execute(task: ScheduledTaskRecord, run: RunIdentity): Promise<void>;
}

export type ScheduledDispatchResult =
  | "executed"
  | "unbound"
  | "stale_binding"
  | "busy"
  | "duplicate";

export class ScheduledTaskDispatcher {
  constructor(
    private readonly bindings: BindingRegistry,
    private readonly runs: RunRegistry,
    private readonly supervisor: WorkerSupervisor,
    private readonly ledger: ScheduledTaskExecutionLedger,
    private readonly port: ScheduledTaskPort,
  ) {}

  async dispatch(task: ScheduledTaskRecord): Promise<ScheduledDispatchResult> {
    const current = this.bindings.getById(task.bindingId);
    if (!current) return "unbound";
    if (!matchesTaskBinding(current, task)) return "stale_binding";
    if (this.runs.current(current.bindingId)) return "busy";

    if (!await this.ledger.claim(task.executionId)) return "duplicate";

    let run: RunIdentity | null = null;
    try {
      const worker = await this.supervisor.ensure(current);
      if (
        !this.bindings.getExact(current) ||
        !this.supervisor.isCurrent(current, worker)
      ) {
        await this.supervisor.stopIfCurrent(current, worker, "stale_scheduled_admission");
        await this.ledger.release(task.executionId);
        return "stale_binding";
      }
      if (this.runs.current(current.bindingId)) {
        await this.ledger.release(task.executionId);
        return "busy";
      }
      run = this.runs.startExclusive(
        current,
        worker.generation,
        "scheduled:" + task.executionId,
      );
      await this.port.execute(task, run);
      this.runs.finish(run);
      run = null;
      await this.ledger.complete(task.executionId);
      return "executed";
    } catch (error) {
      if (run) this.runs.finish(run);
      await this.ledger.release(task.executionId);
      throw error;
    }
  }
}

function matchesTaskBinding(binding: BindingIdentity, task: ScheduledTaskRecord): boolean {
  return (
    binding.bindingId === task.bindingId &&
    binding.botId === task.botId &&
    binding.chatId === task.chatId &&
    binding.threadId === task.threadId &&
    binding.sessionId === task.sessionId &&
    binding.normalizedDirectory === task.normalizedDirectory &&
    binding.bindingGeneration === task.bindingGeneration
  );
}

export class InMemoryExecutionLedger implements ScheduledTaskExecutionLedger {
  readonly #claimed = new Set<string>();
  readonly #completed = new Set<string>();

  async claim(executionId: string): Promise<boolean> {
    if (this.#claimed.has(executionId) || this.#completed.has(executionId)) return false;
    this.#claimed.add(executionId);
    return true;
  }

  async complete(executionId: string): Promise<void> {
    this.#claimed.delete(executionId);
    this.#completed.add(executionId);
  }

  async release(executionId: string): Promise<void> {
    this.#claimed.delete(executionId);
  }
}
