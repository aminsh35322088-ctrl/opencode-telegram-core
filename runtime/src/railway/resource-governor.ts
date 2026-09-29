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
    if (policy.maxRestartsPerBinding < 1) {
      throw new Error("Railway maxRestartsPerBinding must be >= 1");
    }
    if (policy.restartWindowMs <= 0) {
      throw new Error("Railway restartWindowMs must be > 0");
    }
  }

  get trackedRestartBindingCount(): number {
    return this.#restartHistory.size;
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
    this.#pruneRestartHistory(cutoff);

    const recent = this.#restartHistory.get(bindingId) ?? [];
    if (recent.length >= this.policy.maxRestartsPerBinding) return false;

    this.#restartHistory.set(bindingId, [...recent, now]);
    return true;
  }

  #pruneRestartHistory(cutoff: number): void {
    for (const [bindingId, stamps] of this.#restartHistory) {
      const recent = stamps.filter((stamp) => stamp > cutoff);
      if (recent.length === 0) {
        this.#restartHistory.delete(bindingId);
      } else if (recent.length !== stamps.length) {
        this.#restartHistory.set(bindingId, recent);
      }
    }
  }

  static currentSnapshot(workerCount: number, idleWorkerCount: number): RailwayResourceSnapshot {
    return {
      rssBytes: process.memoryUsage.rss(),
      workerCount,
      idleWorkerCount,
    };
  }
}
