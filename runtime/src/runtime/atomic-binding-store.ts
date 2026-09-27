import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { BindingRegistry, type BindingIntegrityError } from "./binding-registry.js";
import type { BindingIdentity } from "./identity.js";

export class AtomicBindingStore {
  readonly registry = new BindingRegistry();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("binding store root must be an array");
    const candidate = new BindingRegistry();
    for (const item of parsed) {
      candidate.register(parseBinding(item));
    }
    for (const item of candidate.list()) this.registry.register(item);
  }

  async register(binding: BindingIdentity): Promise<void> {
    const candidate = this.#cloneRegistry();
    candidate.register(binding);
    await this.#persist(candidate.list());
    this.registry.register(binding);
  }

  async fence(bindingId: string): Promise<BindingIdentity> {
    const current = this.registry.getById(bindingId);
    if (!current) throw new Error("unknown binding " + bindingId);
    const next = Object.freeze({
      ...current,
      bindingGeneration: current.bindingGeneration + 1,
    });
    const candidate = this.#cloneRegistry();
    candidate.replace(next, current.bindingGeneration);

    // Persist first. Only after durable fencing succeeds may the live registry
    // expose the new generation and invalidate the old worker.
    await this.#persist(candidate.list());
    this.registry.replace(next, current.bindingGeneration);
    return next;
  }

  async replace(
    binding: BindingIdentity,
    expectedGeneration: number,
  ): Promise<void> {
    const candidate = this.#cloneRegistry();
    candidate.replace(binding, expectedGeneration);
    await this.#persist(candidate.list());
    this.registry.replace(binding, expectedGeneration);
  }

  async remove(bindingId: string): Promise<void> {
    const candidate = this.#cloneRegistry();
    candidate.remove(bindingId);
    await this.#persist(candidate.list());
    this.registry.remove(bindingId);
  }

  #cloneRegistry(): BindingRegistry {
    const clone = new BindingRegistry();
    for (const binding of this.registry.list()) clone.register(binding);
    return clone;
  }

  async #persist(bindings: readonly BindingIdentity[]): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const tmp = this.filePath + ".tmp-" + process.pid + "-" + crypto.randomUUID();
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(bindings, null, 2) + "\n", "utf8");
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
