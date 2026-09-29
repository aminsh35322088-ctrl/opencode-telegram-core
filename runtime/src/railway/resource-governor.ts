import { readFileSync } from "node:fs";

export interface RailwayResourcePolicy {
  readonly softRssBytes: number;
  readonly hardRssBytes: number;
  readonly maxWorkers: number;
  readonly maxRestartsPerBinding: number;
  readonly restartWindowMs: number;
}

export interface RailwayResourceSnapshot {
  /**
   * Reclaim-aware service working set. On cgroup v2 this is
   * memory.current - inactive_file, matching Docker/cAdvisor semantics.
   */
  readonly rssBytes: number;
  /**
   * Raw cgroup usage. This still includes reclaimable page cache and is used
   * only for the hard/OOM guard. Older callers may omit it.
   */
  readonly totalBytes?: number;
  readonly workerCount: number;
  readonly idleWorkerCount: number;
}

const CGROUP_MEMORY_CURRENT = "/sys/fs/cgroup/memory.current";
const CGROUP_MEMORY_MAX = "/sys/fs/cgroup/memory.max";
const CGROUP_MEMORY_STAT = "/sys/fs/cgroup/memory.stat";

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
    const totalBytes = snapshot.totalBytes ?? snapshot.rssBytes;
    if (totalBytes >= this.policy.hardRssBytes) return "EMERGENCY_SHUTDOWN";
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

  static serviceWorkingSetBytes(
    totalBytes = RailwayResourceGovernor.serviceMemoryBytes(),
  ): number {
    try {
      const stat = readFileSync(CGROUP_MEMORY_STAT, "utf8");
      const inactiveFileLine = stat
        .split(/\r?\n/)
        .find((line) => line.startsWith("inactive_file "));
      if (!inactiveFileLine) return totalBytes;
      const inactiveFileBytes = Number.parseInt(
        inactiveFileLine.slice("inactive_file ".length).trim(),
        10,
      );
      // Match Docker/cAdvisor semantics: subtract inactive_file only when the
      // sampled counter is valid and strictly below the sampled usage.
      if (
        !Number.isSafeInteger(inactiveFileBytes) ||
        inactiveFileBytes <= 0 ||
        inactiveFileBytes >= totalBytes
      ) {
        return totalBytes;
      }
      return totalBytes - inactiveFileBytes;
    } catch {
      return totalBytes;
    }
  }

  static serviceMemoryLimitBytes(): number | null {
    return readPositiveBytes(CGROUP_MEMORY_MAX);
  }

  static currentSnapshot(workerCount: number, idleWorkerCount: number): RailwayResourceSnapshot {
    const totalBytes = RailwayResourceGovernor.serviceMemoryBytes();
    return {
      // Soft admission uses a reclaim-aware working set so inactive page cache
      // does not falsely reject otherwise safe work.
      rssBytes: RailwayResourceGovernor.serviceWorkingSetBytes(totalBytes),
      // Hard protection intentionally keeps the raw cgroup total because
      // memory.max accounts all charged memory, reclaimable or otherwise.
      totalBytes,
      workerCount,
      idleWorkerCount,
    };
  }
}
