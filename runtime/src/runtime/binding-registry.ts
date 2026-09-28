import path from "node:path";
import { bindingKey, type BindingIdentity } from "./identity.js";

export class BindingIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingIntegrityError";
  }
}

export class BindingRegistry {
  readonly #byId = new Map<string, BindingIdentity>();
  readonly #byRoute = new Map<string, string>();

  register(binding: BindingIdentity): void {
    this.#validate(binding);
    if (!Number.isSafeInteger(binding.bindingGeneration) || binding.bindingGeneration < 1) {
      throw new BindingIntegrityError("bindingGeneration must be a positive safe integer");
    }
    const routeKey = bindingKey(binding);
    const existingById = this.#byId.get(binding.bindingId);
    const existingRouteOwner = this.#byRoute.get(routeKey);

    if (existingById && !this.#exact(existingById, binding)) {
      throw new BindingIntegrityError(`bindingId ${binding.bindingId} is ambiguous`);
    }
    if (existingRouteOwner && existingRouteOwner !== binding.bindingId) {
      throw new BindingIntegrityError(`route ${routeKey} has duplicate bindings`);
    }

    this.#byId.set(binding.bindingId, Object.freeze({ ...binding }));
    this.#byRoute.set(routeKey, binding.bindingId);
  }

  replace(binding: BindingIdentity, expectedGeneration: number): void {
    this.#validate(binding);
    const current = this.#byId.get(binding.bindingId);
    if (!current) throw new BindingIntegrityError(`unknown binding ${binding.bindingId}`);
    if (current.bindingGeneration !== expectedGeneration) {
      throw new BindingIntegrityError("binding generation compare-and-swap failed");
    }
    if (
      current.botId !== binding.botId ||
      current.chatId !== binding.chatId ||
      current.threadId !== binding.threadId
    ) {
      throw new BindingIntegrityError("binding route identity cannot change during replacement");
    }
    if (binding.bindingGeneration <= current.bindingGeneration) {
      throw new BindingIntegrityError("replacement generation must increase monotonically");
    }
    this.#byId.set(binding.bindingId, Object.freeze({ ...binding }));
  }

  getExact(candidate: BindingIdentity): BindingIdentity | null {
    const stored = this.#byId.get(candidate.bindingId);
    if (!stored || !this.#exact(stored, candidate)) return null;
    const routeOwner = this.#byRoute.get(bindingKey(candidate));
    return routeOwner === candidate.bindingId ? stored : null;
  }

  getById(bindingId: string): BindingIdentity | null {
    return this.#byId.get(bindingId) ?? null;
  }

  fence(bindingId: string): BindingIdentity {
    const current = this.#byId.get(bindingId);
    if (!current) throw new BindingIntegrityError(`unknown binding ${bindingId}`);
    const next = Object.freeze({
      ...current,
      bindingGeneration: current.bindingGeneration + 1,
    });
    this.replace(next, current.bindingGeneration);
    return next;
  }

  remove(bindingId: string): void {
    const current = this.#byId.get(bindingId);
    if (!current) return;
    this.#byId.delete(bindingId);
    this.#byRoute.delete(bindingKey(current));
  }

  clear(): void {
    this.#byId.clear();
    this.#byRoute.clear();
  }

  list(): readonly BindingIdentity[] {
    return [...this.#byId.values()];
  }

  #validate(binding: BindingIdentity): void {
    if (!path.isAbsolute(binding.normalizedDirectory) || path.resolve(binding.normalizedDirectory) !== binding.normalizedDirectory) {
      throw new BindingIntegrityError("normalizedDirectory must be an absolute canonical lexical path");
    }
  }

  #exact(a: BindingIdentity, b: BindingIdentity): boolean {
    return (
      a.bindingId === b.bindingId &&
      a.botId === b.botId &&
      a.chatId === b.chatId &&
      a.threadId === b.threadId &&
      a.sessionId === b.sessionId &&
      a.normalizedDirectory === b.normalizedDirectory &&
      a.bindingGeneration === b.bindingGeneration
    );
  }
}
