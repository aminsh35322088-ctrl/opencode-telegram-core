import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { BindingIntegrityError, BindingRegistry } from "./binding-registry.js";
import type { BindingIdentity } from "./identity.js";

type BindingLifecycle = "ACTIVE" | "DELETING";

interface BindingRecord {
  readonly lifecycle: BindingLifecycle;
  readonly binding: BindingIdentity;
}

interface PersistedBindingStoreV1 {
  readonly version: 1;
  readonly records: readonly BindingRecord[];
}

export class AtomicBindingStore {
  readonly registry = new BindingRegistry();
  readonly #records = new Map<string, BindingRecord>();
  #lock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    return this.#withLock(() => this.#load());
  }

  async #load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    const parsed: unknown = JSON.parse(raw);
    const records = parseStore(parsed);

    // Validate all persisted identities, including tombstones, so an incomplete
    // delete can never coexist ambiguously with a new route after restart.
    const all = new BindingRegistry();
    for (const record of records) {
      if (this.#records.has(record.binding.bindingId)) {
        throw new BindingIntegrityError("duplicate persisted bindingId " + record.binding.bindingId);
      }
      all.register(record.binding);
      this.#records.set(record.binding.bindingId, record);
      if (record.lifecycle === "ACTIVE") {
        this.registry.register(record.binding);
      }
    }
  }

  async register(binding: BindingIdentity): Promise<void> {
    return this.#withLock(() => this.#register(binding));
  }

  async #register(binding: BindingIdentity): Promise<void> {
    if (this.#records.has(binding.bindingId)) {
      throw new BindingIntegrityError("bindingId already exists: " + binding.bindingId);
    }
    const records = new Map(this.#records);
    records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.#validateRecords(records);
    await this.#persist(records);
    this.#records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.registry.register(binding);
  }

  async fence(bindingId: string): Promise<BindingIdentity> {
    return this.#withLock(() => this.#fence(bindingId));
  }

  async #fence(bindingId: string): Promise<BindingIdentity> {
    const current = this.registry.getById(bindingId);
    if (!current) throw new Error("unknown active binding " + bindingId);
    const next = Object.freeze({
      ...current,
      bindingGeneration: current.bindingGeneration + 1,
    });
    await this.replace(next, current.bindingGeneration);
    return next;
  }

  async replace(
    binding: BindingIdentity,
    expectedGeneration: number,
  ): Promise<void> {
    return this.#withLock(() => this.#replace(binding, expectedGeneration));
  }

  async #replace(
    binding: BindingIdentity,
    expectedGeneration: number,
  ): Promise<void> {
    const record = this.#records.get(binding.bindingId);
    if (!record || record.lifecycle !== "ACTIVE") {
      throw new Error("cannot replace non-active binding " + binding.bindingId);
    }
    const candidateRegistry = this.#activeRegistryClone();
    candidateRegistry.replace(binding, expectedGeneration);

    const records = new Map(this.#records);
    records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.#validateRecords(records);

    // Persistence is the fencing linearization point.
    await this.#persist(records);
    this.#records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.registry.replace(binding, expectedGeneration);
  }

  async beginDelete(bindingId: string): Promise<BindingIdentity> {
    return this.#withLock(() => this.#beginDelete(bindingId));
  }

  async #beginDelete(bindingId: string): Promise<BindingIdentity> {
    const current = this.registry.getById(bindingId);
    if (!current) {
      const tombstone = this.#records.get(bindingId);
      if (tombstone?.lifecycle === "DELETING") return tombstone.binding;
      throw new Error("unknown active binding " + bindingId);
    }

    const fenced = Object.freeze({
      ...current,
      bindingGeneration: current.bindingGeneration + 1,
    });
    const records = new Map(this.#records);
    records.set(bindingId, { lifecycle: "DELETING", binding: fenced });
    this.#validateRecords(records);

    // Persist DELETING before live route removal. A crash from this point on
    // reloads as a tombstone, never as an active route.
    await this.#persist(records);
    this.#records.set(bindingId, { lifecycle: "DELETING", binding: fenced });
    this.registry.replace(fenced, current.bindingGeneration);
    this.registry.remove(bindingId);
    return fenced;
  }

  async completeDelete(bindingId: string): Promise<void> {
    return this.#withLock(() => this.#completeDelete(bindingId));
  }

  async #completeDelete(bindingId: string): Promise<void> {
    const record = this.#records.get(bindingId);
    if (!record) return;
    if (record.lifecycle !== "DELETING") {
      throw new Error("binding is not deleting: " + bindingId);
    }
    const records = new Map(this.#records);
    records.delete(bindingId);
    await this.#persist(records);
    this.#records.delete(bindingId);
  }

  pendingDeletes(): readonly BindingIdentity[] {
    return [...this.#records.values()]
      .filter((record) => record.lifecycle === "DELETING")
      .map((record) => record.binding);
  }

  async remove(bindingId: string): Promise<void> {
    return this.#withLock(() => this.#remove(bindingId));
  }

  async #remove(bindingId: string): Promise<void> {
    if (this.registry.getById(bindingId)) await this.#beginDelete(bindingId);
    await this.#completeDelete(bindingId);
  }

  // Every mutation runs behind this queue so a snapshot taken before an
  // await can never be persisted over a change committed while it slept.
  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const predecessor = this.#lock;
    let release!: () => void;
    this.#lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  #activeRegistryClone(): BindingRegistry {
    const clone = new BindingRegistry();
    for (const binding of this.registry.list()) clone.register(binding);
    return clone;
  }

  #validateRecords(records: ReadonlyMap<string, BindingRecord>): void {
    const validator = new BindingRegistry();
    for (const record of records.values()) validator.register(record.binding);
  }

  async #persist(records: ReadonlyMap<string, BindingRecord>): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const tmp = this.filePath + ".tmp-" + process.pid + "-" + crypto.randomUUID();
    const handle = await open(tmp, "wx", 0o600);
    const payload: PersistedBindingStoreV1 = {
      version: 1,
      records: [...records.values()].sort((a, b) =>
        a.binding.bindingId.localeCompare(b.binding.bindingId)
      ),
    };
    try {
      await handle.writeFile(JSON.stringify(payload, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(tmp, this.filePath);
      const dir = await open(directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }
}

function parseStore(value: unknown): readonly BindingRecord[] {
  // Phase-1 compatibility: accept the original array-only format as ACTIVE.
  if (Array.isArray(value)) {
    return value.map((entry) => ({ lifecycle: "ACTIVE", binding: parseBinding(entry) }));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("binding store root must be an object");
  }
  const root = value as Record<string, unknown>;
  if (root.version !== 1 || !Array.isArray(root.records)) {
    throw new Error("unsupported binding store version");
  }
  return root.records.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("binding record must be an object");
    }
    const record = entry as Record<string, unknown>;
    if (record.lifecycle !== "ACTIVE" && record.lifecycle !== "DELETING") {
      throw new Error("invalid binding lifecycle");
    }
    return {
      lifecycle: record.lifecycle,
      binding: parseBinding(record.binding),
    };
  });
}

function parseBinding(value: unknown): BindingIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("binding store entry must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const field of ["bindingId", "botId", "sessionId", "normalizedDirectory"] as const) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new Error("invalid persisted binding field: " + field);
    }
  }
  for (const field of ["chatId", "threadId", "bindingGeneration"] as const) {
    if (!Number.isSafeInteger(record[field])) {
      throw new Error("invalid persisted binding field: " + field);
    }
  }
  return {
    bindingId: record.bindingId as string,
    botId: record.botId as string,
    chatId: record.chatId as number,
    threadId: record.threadId as number,
    sessionId: record.sessionId as string,
    normalizedDirectory: record.normalizedDirectory as string,
    bindingGeneration: record.bindingGeneration as number,
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}
