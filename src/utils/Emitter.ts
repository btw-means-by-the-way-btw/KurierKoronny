type Listener<A extends unknown[]> = (...args: A) => void;

/** Minimal typed event emitter. */
export class Emitter<Events extends { [K in keyof Events]: unknown[] }> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event]?.delete(fn);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]) {
    this.listeners[event]?.forEach((fn) => {
      try {
        fn(...args);
      } catch (e) {
        console.error(`Listener for ${String(event)} failed`, e);
      }
    });
  }

  removeAll() {
    this.listeners = {};
  }
}
