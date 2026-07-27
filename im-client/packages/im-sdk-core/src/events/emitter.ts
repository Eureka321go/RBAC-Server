type Handler<T> = (payload: T) => void;

export class Emitter<E extends Record<string, unknown>> {
  private readonly handlers: { [K in keyof E]?: Set<Handler<E[K]>> } = {};

  on<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    (this.handlers[key] ??= new Set()).add(fn);
    return () => this.off(key, fn);
  }

  off<K extends keyof E>(key: K, fn: Handler<E[K]>): void {
    this.handlers[key]?.delete(fn);
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    this.handlers[key]?.forEach((fn) => fn(payload));
  }
}
