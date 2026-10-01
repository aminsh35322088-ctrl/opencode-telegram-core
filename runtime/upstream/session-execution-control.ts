// Shared source for the upstream runtime integration. The native client must
// consume its runtime API rather than instantiate a second execution authority.
export interface ExecutionOwner {
  readonly sessionId: string;
  readonly runId: string;
  readonly directory: string;
}

export interface ExecutionResource {
  pause(): void;
  resume(): void;
  terminate(): void;
}

export interface SessionExecutionFrame {
  readonly execution: SessionExecutionLease;
  checkpoint(signal?: AbortSignal): Promise<void>;
  continue(owner: ExecutionOwner): void;
  release(): ExecutionOwner[];
}

export class SessionExecutionControl {
  readonly #runs = new Map<string, SessionExecutionLease>();
  readonly #failed = new Set<string>();
  readonly #closing = new Set<string>();
  readonly #closingDirectories = new Set<string>();
  #disposed = false;

  start(owner: ExecutionOwner, parent?: ExecutionOwner): SessionExecutionLease {
    if (!owner.sessionId.trim() || !owner.runId.trim() || !owner.directory.trim()) throw new Error("execution owner is incomplete");
    const key = executionKey(owner);
    if (this.#disposed) throw new Error("execution control is disposed");
    if (this.#failed.has(owner.directory)) throw new Error("execution resource isolation failed");
    if (this.#closingDirectories.has(owner.directory)) throw new Error("execution workspace is retiring");
    if (this.#closing.has(key)) throw new Error("execution owner is retiring");
    if (this.#runs.has(key)) throw new Error("session already owns a live execution");
    const ancestor = parent ? this.#require(parent) : undefined;
    ancestor?.assertOwned();
    if (ancestor && ancestor.owner.directory !== owner.directory) throw new Error("child execution must remain in its parent's workspace");
    const run = new SessionExecutionLease(Object.freeze({ ...owner }), ancestor);
    this.#runs.set(key, run);
    return run;
  }

  get(owner: ExecutionOwner): SessionExecutionLease | undefined {
    const run = this.#runs.get(executionKey(owner));
    return run?.owner.runId === owner.runId ? run : undefined;
  }

  pause(owner: ExecutionOwner): void { this.#change(owner, true); }
  resume(owner: ExecutionOwner): void { this.#change(owner, false); }

  retain(owner: ExecutionOwner, parent?: { readonly owner: ExecutionOwner; readonly epoch: number }): SessionExecutionFrame {
    const run = this.#require(owner);
    if (parent) {
      const ancestor = this.#require(parent.owner);
      ancestor.assertOwned(parent.epoch);
      if (run.parentOwner?.sessionId !== ancestor.owner.sessionId || !run.descendsFrom(ancestor)) {
        throw new Error("task update owner mismatch");
      }
    }
    run.retain(Boolean(parent));
    const controller = new AbortController();
    const assertActive = (): void => {
      controller.signal.throwIfAborted();
      if (this.get(owner) !== run) throw new Error("stale task frame owner");
    };
    return {
      execution: run,
      checkpoint: async (signal) => {
        assertActive();
        await run.retainedCheckpoint(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal);
        assertActive();
      },
      continue: (target) => {
        assertActive();
        const parent = this.#require(target);
        if (!run.descendsFrom(parent)) throw new Error("task frame is not owned by this execution");
        parent.continue();
      },
      release: () => {
        if (controller.signal.aborted) return [];
        controller.abort(new Error("task frame retired"));
        run.release();
        return this.get(owner) === run ? this.#prune(run) : [];
      },
    };
  }

  // Main execution may finish before a background child. Retain its owner as
  // the child's pause/abort authority until every descendant has finished.
  finish(owner: ExecutionOwner): ExecutionOwner[] {
    const run = this.#require(owner);
    run.finish();
    return this.#prune(run);
  }

  #prune(current: SessionExecutionLease): ExecutionOwner[] {
    let run: SessionExecutionLease | undefined = current;
    const retired: ExecutionOwner[] = [];
    while (run?.finished && run.retained === 0 && this.#tree(run).length === 1) {
      const parent: ExecutionOwner | undefined = run.parentOwner;
      this.#retire(run.owner, true);
      retired.push(run.owner);
      run = parent ? this.get(parent) : undefined;
    }
    return retired;
  }

  close(owner: ExecutionOwner): void {
    this.#retire(owner, false);
  }

  #retire(owner: ExecutionOwner, normalFinish: boolean): void {
    const root = this.#require(owner);
    const errors: unknown[] = [];
    const tree = this.#tree(root).reverse();
    this.#closingDirectories.add(root.owner.directory);
    for (const run of tree) this.#closing.add(executionKey(run.owner));
    for (const run of tree) {
      try { run.retire(normalFinish); } catch (error) {
        this.#failed.add(run.owner.directory);
        for (const live of this.#runs.values()) {
          if (live.owner.directory === run.owner.directory) live.fail(error);
        }
        errors.push(error);
      } finally {
        this.#runs.delete(executionKey(run.owner));
      }
    }
    for (const run of tree) this.#closing.delete(executionKey(run.owner));
    this.#closingDirectories.delete(root.owner.directory);
    if (errors.length) throw new AggregateError(errors, "execution resource cleanup failed");
  }

  dispose(): void {
    this.#disposed = true;
    const errors: unknown[] = [];
    for (const run of [...this.#runs.values()]) {
      if (!this.get(run.owner)) continue;
      try { this.close(run.owner); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "execution resource cleanup failed");
  }

  #change(owner: ExecutionOwner, paused: boolean): void {
    const root = this.#require(owner);
    const tree = this.#tree(root);
    const previous = tree.map((run) => run.paused);
    root.setPaused(paused);
    const errors: unknown[] = [];
    tree.forEach((run, index) => {
      try { run.transition(previous[index]!); } catch (error) { errors.push(error); }
    });
    if (errors.length) {
      const failure = new AggregateError(errors, "execution resource transition failed");
      // Resume is not an atomic OS operation. Fence every continuation and
      // best-effort suspend resources already resumed before a sibling failed.
      for (const run of tree) run.fail(failure);
      for (const run of tree) {
        try { run.transition(false); } catch { /* Every lease already exposes the failure. */ }
      }
      throw failure;
    }
  }

  #tree(root: SessionExecutionLease): SessionExecutionLease[] {
    return [...this.#runs.values()].filter((run) => run.descendsFrom(root));
  }

  #require(owner: ExecutionOwner): SessionExecutionLease {
    const run = this.get(owner);
    if (!run || this.#closing.has(executionKey(owner)) || this.#closingDirectories.has(owner.directory)) throw new Error("stale execution owner");
    return run;
  }
}

export class SessionExecutionLease {
  readonly #controller = new AbortController();
  readonly #resources = new Set<ExecutionResource>();
  readonly #waiters = new Set<() => void>();
  readonly #observers = new Set<(error?: unknown) => void>();
  readonly #children = new Set<SessionExecutionLease>();
  #paused = false;
  #finished = false;
  #epoch = 1;
  #retained = 0;
  #normalFinish = false;
  #failure: unknown;

  constructor(readonly owner: ExecutionOwner, private readonly parent?: SessionExecutionLease) {
    if (parent) parent.#children.add(this);
  }

  get signal(): AbortSignal { return this.#controller.signal; }
  get paused(): boolean { return this.#paused || Boolean(this.parent?.paused); }
  get finished(): boolean { return this.#finished; }
  get epoch(): number { return this.#epoch; }
  get retained(): number { return this.#retained; }
  get parentOwner(): ExecutionOwner | undefined { return this.parent?.owner; }

  descendsFrom(root: SessionExecutionLease): boolean {
    return this === root || Boolean(this.parent?.descendsFrom(root));
  }

  setPaused(paused: boolean): void {
    this.#assertTreeLive();
    this.#paused = paused;
  }

  transition(previous: boolean): void {
    if (!this.paused) {
      try { this.#assertTreeLive(); } catch (error) { this.#wake(); throw error; }
    }
    const errors: unknown[] = [];
    if (previous !== this.paused) {
      for (const resource of this.#resources) {
        try { if (this.paused) resource.pause(); else resource.resume(); } catch (error) { errors.push(error); }
      }
    }
    if (errors.length) this.#failure = new AggregateError(errors, "execution resource transition failed");
    this.#wake();
    this.#assertTreeLive();
  }

  attach(resource: ExecutionResource): () => void {
    this.#assertLive();
    this.#resources.add(resource);
    if (this.paused) {
      try { resource.pause(); } catch (error) { this.#failure = error; this.#wake(); throw error; }
    }
    return () => { this.#resources.delete(resource); };
  }

  checkpoint(signal?: AbortSignal, epoch?: number): Promise<void> {
    return this.#checkpoint(signal, false, epoch);
  }

  retainedCheckpoint(signal?: AbortSignal): Promise<void> {
    return this.#checkpoint(signal, true);
  }

  async #checkpoint(signal: AbortSignal | undefined, retained: boolean, epoch?: number): Promise<void> {
    while (true) {
      if (epoch !== undefined && epoch !== this.#epoch) throw new Error("stale execution continuation");
      if (retained) this.#assertTreeLive(); else this.#assertLive();
      signal?.throwIfAborted();
      if (!this.paused) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.#waiters.delete(wake); signal?.removeEventListener("abort", abort); };
        const wake = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(signal!.reason); };
        this.#waiters.add(wake);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }

  subscribe(listener: (error?: unknown) => void): () => void {
    this.#assertTreeLive();
    this.#observers.add(listener);
    return () => { this.#observers.delete(listener); };
  }

  retire(normalFinish = false): void {
    this.#normalFinish = normalFinish;
    this.#controller.abort(new Error(normalFinish ? "execution finished" : "execution owner retired"));
    const errors = this.#wake();
    for (const resource of this.#resources) {
      try { resource.terminate(); } catch (error) { errors.push(error); }
    }
    this.#resources.clear();
    this.#observers.clear();
    if (this.parent) this.parent.#children.delete(this);
    if (errors.length) throw new AggregateError(errors, "execution resource cleanup failed");
  }

  #assertLive(): void {
    this.#assertTreeLive();
    if (this.#finished) throw new Error("execution continuation finished");
  }

  #assertTreeLive(): void {
    this.signal.throwIfAborted();
    if (this.parent) this.parent.#assertTreeLive();
    if (this.#failure) throw this.#failure;
  }

  assertOwned(epoch?: number): void {
    if (epoch !== undefined && epoch !== this.#epoch) throw new Error("stale execution continuation");
    this.#assertLive();
  }

  retain(update = false): void {
    this.#assertTreeLive();
    if (this.#finished && (!update || this.#retained === 0)) throw new Error("execution continuation finished");
    this.#retained += 1;
  }
  release(): void { this.#retained -= 1; }
  continue(): void {
    this.#assertTreeLive();
    if (this.#finished) this.#epoch += 1;
    this.#finished = false;
  }

  finish(): void {
    this.#assertTreeLive();
    if (this.#resources.size) throw new Error("cannot finish execution with live owned resources");
    this.#finished = true;
    this.#wake();
    this.#assertTreeLive();
  }

  fail(error: unknown): void { this.#paused = true; this.#failure = error; this.#wake(); }

  #activityError(): unknown {
    if (this.#failure) return this.#failure;
    if (this.signal.aborted && !this.#normalFinish) return this.signal.reason;
    return this.parent ? this.parent.#activityError() : undefined;
  }

  #wake(): unknown[] {
    const errors: unknown[] = [];
    for (const wake of [...this.#waiters]) wake();
    for (const observer of [...this.#observers]) {
      try { observer(this.#activityError()); } catch (error) {
        errors.push(error);
        this.#observers.delete(observer);
        this.#paused = true;
        this.#failure = new AggregateError(errors, "execution activity observer failed");
      }
    }
    // An observer later in the first pass may have fenced the lease. Earlier
    // observers must receive that failure too; never leave a live deadline
    // subscribed only to the preceding healthy notification.
    if (errors.length) {
      for (const observer of [...this.#observers]) {
        try { observer(this.#activityError()); } catch (error) {
          errors.push(error);
          this.#observers.delete(observer);
        }
      }
      this.#failure = new AggregateError(errors, "execution activity observer failed");
    }
    // Failures can originate outside a tree transition, including admission
    // of a resource while paused. Every inherited waiter must observe them.
    if (this.#activityError()) {
      for (const child of [...this.#children]) errors.push(...child.#wake());
    }
    return errors;
  }
}

function executionKey(owner: ExecutionOwner): string {
  return JSON.stringify([owner.directory, owner.sessionId]);
}
