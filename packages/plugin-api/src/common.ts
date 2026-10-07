export interface Disposable {
  dispose(): void;
}

export function toDisposable(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (done) return;
      done = true;
      fn();
    },
  };
}

/** Collects disposables and disposes them in reverse order. */
export class DisposableStore implements Disposable {
  private items: Disposable[] = [];
  add<T extends Disposable>(d: T): T {
    this.items.push(d);
    return d;
  }
  dispose() {
    for (const d of this.items.reverse()) {
      try {
        d.dispose();
      } catch (err) {
        console.error(err);
      }
    }
    this.items = [];
  }
}

type Handler<P> = (payload: P) => void;

/** Small typed event bus shared by the web and server plugin hosts. */
export class Emitter<Events extends object> {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): Disposable {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return toDisposable(() => set.delete(handler));
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[events] handler for ${String(event)} threw`, err);
      }
    }
  }
}
