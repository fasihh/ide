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

/**
 * JSON body type of the non-error responses in a Hono client response union. Responses with an
 * explicit error status (e.g. a validator's 400) have `ok: false` and are dropped.
 */
export type SuccessJson<R> = R extends { ok: false } ? never : R extends { json(): Promise<infer T> } ? T : never;

/**
 * Await a Hono RPC call and return its typed JSON body, throwing the server's `{ error }`
 * message (or the status) on non-2xx responses.
 *
 *   const data = await unwrap(api.items.$get());
 */
export async function unwrap<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(
  request: Promise<R>,
): Promise<SuccessJson<R>> {
  const res = await request;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
  }
  return (await res.json()) as SuccessJson<R>;
}
