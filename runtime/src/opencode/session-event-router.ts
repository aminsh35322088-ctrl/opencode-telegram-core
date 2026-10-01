import type { BindingRegistry } from "../runtime/binding-registry.js";
import { sameBinding, type BindingIdentity, type RunIdentity } from "../runtime/identity.js";
import { parseExecutionEventOrigin } from "./event-provenance.js";
import type { RunRegistry } from "../runtime/run-registry.js";
import { withDeadline } from "../runtime/deadline.js";

export type SessionParentLookup = (
  sessionId: string,
  normalizedDirectory: string,
  signal: AbortSignal,
) => Promise<string | null>;

const MAX_PARENT_DEPTH = 32;
const PARENT_CACHE_LIMIT = 1024;

/** Resolves events using exact root identities or authoritative session ancestry. */
export class SessionEventRouter {
  readonly #parents = new Map<string, string | null>();

  constructor(
    private readonly bindings: BindingRegistry,
    private readonly runs: RunRegistry,
    private readonly lookupParent?: SessionParentLookup,
    private readonly lookupTimeoutMs = 10_000,
  ) {}

  /** Execution delivery requires the publisher's original owner and returns a complete run fence. */
  async resolveExecution(
    sessionId: string | null,
    normalizedDirectory: string | null,
    inputOrigin: unknown,
  ): Promise<RunIdentity | null> {
    const origin = parseExecutionEventOrigin(inputOrigin);
    if (!sessionId || !normalizedDirectory || !origin || origin.root.directory !== normalizedDirectory) return null;
    const roots = this.bindings.list().filter(binding =>
      binding.sessionId === origin.root.sessionId && binding.normalizedDirectory === normalizedDirectory
    );
    if (roots.length !== 1) return null;
    const binding = roots[0]!;
    const run = this.runs.current(binding.bindingId);
    if (!run || !sameBinding(run, binding) || run.runId !== origin.root.runId) return null;
    const route = await this.resolve(sessionId, normalizedDirectory);
    return route && sameBinding(route, run) && this.runs.accepts(run) ? run : null;
  }

  async resolve(sessionId: string | null, normalizedDirectory: string | null): Promise<BindingIdentity | null> {
    const snapshot = this.bindings.list();
    const inDirectory = snapshot.filter(binding =>
      normalizedDirectory !== null && binding.normalizedDirectory === normalizedDirectory
    );
    if (!sessionId) return inDirectory.length === 1 ? this.bindings.getExact(inDirectory[0]!) : null;

    const known = snapshot.filter(binding => binding.sessionId === sessionId);
    if (known.length > 0) {
      const exact = known.filter(binding => !normalizedDirectory || binding.normalizedDirectory === normalizedDirectory);
      return exact.length === 1 ? this.bindings.getExact(exact[0]!) : null;
    }
    if (!normalizedDirectory || !this.lookupParent) return null;

    // Capture run ownership before any lookup can yield. A replacement run
    // must never inherit an event admitted against an earlier run.
    const owners = inDirectory.flatMap(binding => {
      const run = this.runs.current(binding.bindingId);
      return run && sameBinding(run, binding) ? [{ binding, run }] : [];
    });
    if (owners.length === 0) return null;

    try {
      return await withDeadline(async (signal) => {
        const visited = new Set<string>();
        let current = sessionId;
        for (let depth = 0; depth < MAX_PARENT_DEPTH; depth += 1) {
          if (visited.has(current)) return null;
          visited.add(current);
          const parent = await this.#parent(current, normalizedDirectory, signal);
          if (!parent) return null;
          const ancestors = snapshot.filter(binding => binding.sessionId === parent);
          if (ancestors.length > 0) {
            if (ancestors.filter(binding => binding.normalizedDirectory === normalizedDirectory).length !== 1) return null;
            const matches = owners.filter(owner => owner.binding.sessionId === parent);
            if (matches.length !== 1) return null;
            const owner = matches[0]!;
            return this.runs.accepts(owner.run) ? this.bindings.getExact(owner.binding) : null;
          }
          current = parent;
        }
        return null;
      }, { timeoutMs: this.lookupTimeoutMs, label: "session event ancestry" });
    } catch {
      return null;
    }
  }

  async #parent(sessionId: string, directory: string, signal: AbortSignal): Promise<string | null> {
    signal.throwIfAborted();
    const key = JSON.stringify([directory, sessionId]);
    if (this.#parents.has(key)) return this.#parents.get(key)!;
    const parent = await this.lookupParent!(sessionId, directory, signal);
    signal.throwIfAborted();
    if (parent !== null && (typeof parent !== "string" || parent.length === 0)) {
      throw new Error("invalid session parent identity");
    }
    this.#parents.set(key, parent);
    if (this.#parents.size > PARENT_CACHE_LIMIT) this.#parents.delete(this.#parents.keys().next().value!);
    return parent;
  }
}
