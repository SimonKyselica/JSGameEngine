export type Unsubscribe = () => void;

/**
 * A single typed event. Listeners are called in connection order and may safely
 * connect or disconnect listeners while an emit is in progress.
 */
export class Signal<T = void> {
  private readonly listeners = new Set<(payload: T) => void>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  connect(listener: (payload: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(payload: T): void {
    if (this.listeners.size === 0) {
      return;
    }
    for (const listener of [...this.listeners]) {
      // A listener removed by an earlier listener in this emit must not be called.
      if (this.listeners.has(listener)) {
        listener(payload);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
