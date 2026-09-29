import { readFileSync } from "node:fs";

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


const CGROUP_MEMORY_CURRENT = "/sys/fs/cgroup/memory.current";
const CGROUP_MEMORY_MAX = "/sys/fs/cgroup/memory.max";

function readPositiveBytes(filePath: string): number | null {
  try {
    const value = readFileSync(filePath, "utf8").trim();
    if (!value || value === "max") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
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

  static serviceMemoryBytes(): number {
    return readPositiveBytes(CGROUP_MEMORY_CURRENT) ?? process.memoryUsage.rss();
  }

  static serviceMemoryLimitBytes(): number | null {
    return readPositiveBytes(CGROUP_MEMORY_MAX);
  }

  static currentSnapshot(workerCount: number, idleWorkerCount: number): RailwayResourceSnapshot {
    return {
      // On Railway/Linux this is the cgroup-wide service footprint, including
      // the bot, OpenCode, tailscaled, MCPs and descendants. RSS is only the
      // cross-platform fallback when cgroup v2 is unavailable.
      rssBytes: RailwayResourceGovernor.serviceMemoryBytes(),
      workerCount,
      idleWorkerCount,
    };
  }
}
