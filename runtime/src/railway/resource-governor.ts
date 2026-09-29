export interface RailwayResourcePolicy {
  readonly softRssBytes: number;
  readonly hardRssBytes: number;
  readonly maxWorkers: number;
  readonly maxRestartsPerBinding: number;
  readonly restartWindowMs: number;
}

export interface RailwayResourceSnapshot {
  readonly rssBytes: number;
  readonly workerCount: number;
  readonly idleWorkerCount: number;
}

export type RailwayResourceAction =
  | "NORMAL"
  | "EVICT_IDLE"
  | "REJECT_NEW_WORK"
  | "EMERGENCY_SHUTDOWN";

export class RailwayResourceGovernor {
  readonly #restartHistory = new Map<string, number[]>();

  constructor(
    readonly policy: RailwayResourcePolicy,
    private readonly now: () => number = Date.now,
  ) {
    if (policy.softRssBytes <= 0 || policy.hardRssBytes <= policy.softRssBytes) {
      throw new Error("Railway RSS thresholds are invalid");
    }
    if (policy.maxWorkers < 1) throw new Error("Railway maxWorkers must be >= 1");
  }

  evaluate(snapshot: RailwayResourceSnapshot): RailwayResourceAction {
    if (snapshot.rssBytes >= this.policy.hardRssBytes) return "EMERGENCY_SHUTDOWN";
    if (snapshot.rssBytes >= this.policy.softRssBytes) {
      return snapshot.idleWorkerCount > 0 ? "EVICT_IDLE" : "REJECT_NEW_WORK";
    }
    if (snapshot.workerCount >= this.policy.maxWorkers) {
      return snapshot.idleWorkerCount > 0 ? "EVICT_IDLE" : "REJECT_NEW_WORK";
    }
    return "NORMAL";
  }

  permitRestart(bindingId: string): boolean {
    const now = this.now();
    const cutoff = now - this.policy.restartWindowMs;
    const previous = this.#restartHistory.get(bindingId);
    const recent = previous === undefined ? [] : previous.filter((stamp) => stamp > cutoff);
    if (recent.length >= this.policy.maxRestartsPerBinding) {
      // Drop the key once the window has drained, so bindings that stop being
      // restarted do not accumulate here for the lifetime of the process.
      if (recent.length === 0) this.#restartHistory.delete(bindingId);
      else this.#restartHistory.set(bindingId, recent);
      return false;
    }
    recent.push(now);
    this.#restartHistory.set(bindingId, recent);
    return true;
  }

  static currentSnapshot(workerCount: number, idleWorkerCount: number): RailwayResourceSnapshot {
    return {
      rssBytes: process.memoryUsage.rss(),
      workerCount,
      idleWorkerCount,
    };
  }
}
