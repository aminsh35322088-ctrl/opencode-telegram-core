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
    this.#byId.set(bindingId, next);
    return next;
  }

  remove(bindingId: string): void {
    const current = this.#byId.get(bindingId);
    if (!current) return;
    this.#byId.delete(bindingId);
    this.#byRoute.delete(bindingKey(current));
  }

  list(): readonly BindingIdentity[] {
    return [...this.#byId.values()];
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
