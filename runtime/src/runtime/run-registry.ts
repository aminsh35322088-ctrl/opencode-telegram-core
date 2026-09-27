import { randomUUID } from "node:crypto";
import { sameBinding, type BindingIdentity, type RunIdentity } from "./identity.js";

export class RunRegistry {
  readonly #active = new Map<string, RunIdentity>();

  start(binding: BindingIdentity, workerGeneration: number, runId: string = randomUUID()): RunIdentity {
    const run = Object.freeze({ ...binding, workerGeneration, runId });
    this.#active.set(binding.bindingId, run);
    return run;
  }

  current(bindingId: string): RunIdentity | null {
    return this.#active.get(bindingId) ?? null;
  }

  accepts(candidate: RunIdentity): boolean {
    const current = this.#active.get(candidate.bindingId);
    return current !== undefined &&
      sameBinding(current, candidate) &&
      current.runId === candidate.runId &&
      current.workerGeneration === candidate.workerGeneration;
  }

  finish(candidate: RunIdentity): boolean {
    if (!this.accepts(candidate)) return false;
    this.#active.delete(candidate.bindingId);
    return true;
  }

  fence(bindingId: string): void {
    this.#active.delete(bindingId);
  }
}
