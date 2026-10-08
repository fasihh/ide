/** A message channel that carries JSON-RPC messages as text (a WebSocket, or a pair in tests). */
export interface Transport {
  send(text: string): void;
  onMessage(cb: (text: string) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

export interface Disposable {
  dispose(): void;
}

type Id = number | string;
type Message = {
  jsonrpc: "2.0";
  id?: Id | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** JSON-RPC error codes this client uses. */
export const ErrorCodes = { MethodNotFound: -32601, InternalError: -32603, RequestCancelled: -32800 } as const;

export class ResponseError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON-RPC 2.0 over a `Transport`: requests both ways, notifications, LSP-style cancellation. */
export class JsonRpcConnection implements Disposable {
  private nextId = 1;
  private readonly pending = new Map<Id, { resolve(v: unknown): void; reject(e: Error): void }>();
  private readonly notificationHandlers = new Map<string, (params: any) => void>();
  private readonly requestHandlers = new Map<string, (params: any) => unknown>();
  private closed = false;
  private readonly closeListeners: (() => void)[] = [];

  constructor(private readonly transport: Transport) {
    transport.onMessage((text) => this.receive(text));
    transport.onClose(() => this.handleClose());
  }

  /** Send a request; aborting `signal` sends `$/cancelRequest` and rejects with RequestCancelled. */
  request<R>(method: string, params?: unknown, signal?: AbortSignal): Promise<R> {
    if (this.closed) return Promise.reject(new ResponseError(ErrorCodes.InternalError, "Connection closed"));
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      signal?.addEventListener("abort", () => {
        if (!this.pending.delete(id)) return;
        this.notify("$/cancelRequest", { id });
        reject(new ResponseError(ErrorCodes.RequestCancelled, "Request cancelled"));
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown) {
    if (!this.closed) this.send({ jsonrpc: "2.0", method, params });
  }

  onNotification<P>(method: string, handler: (params: P) => void): Disposable {
    this.notificationHandlers.set(method, handler);
    return { dispose: () => this.notificationHandlers.delete(method) };
  }

  /** Answer requests the server sends. Unhandled methods get MethodNotFound. */
  onRequest<P>(method: string, handler: (params: P) => unknown): Disposable {
    this.requestHandlers.set(method, handler);
    return { dispose: () => this.requestHandlers.delete(method) };
  }

  onClose(cb: () => void) {
    this.closeListeners.push(cb);
  }

  get isClosed() {
    return this.closed;
  }

  dispose() {
    this.transport.close();
    this.handleClose();
  }

  private send(message: Message) {
    this.transport.send(JSON.stringify(message));
  }

  private receive(text: string) {
    let message: Message;
    try {
      message = JSON.parse(text) as Message;
    } catch {
      return;
    }
    if (message.method === undefined) return this.settle(message);
    if (message.id === undefined || message.id === null) return this.notificationHandlers.get(message.method)?.(message.params);
    void this.answer(message.id, message.method, message.params);
  }

  private settle(message: Message) {
    if (message.id === undefined || message.id === null) return;
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.error) waiter.reject(new ResponseError(message.error.code, message.error.message));
    else waiter.resolve(message.result ?? null);
  }

  private async answer(id: Id, method: string, params: unknown) {
    const handler = this.requestHandlers.get(method);
    if (!handler) return this.send({ jsonrpc: "2.0", id, error: { code: ErrorCodes.MethodNotFound, message: `Unhandled method ${method}` } });
    try {
      this.send({ jsonrpc: "2.0", id, result: (await handler(params)) ?? null });
    } catch (err) {
      this.send({ jsonrpc: "2.0", id, error: { code: ErrorCodes.InternalError, message: String((err as Error)?.message ?? err) } });
    }
  }

  private handleClose() {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values()) waiter.reject(new ResponseError(ErrorCodes.InternalError, "Connection closed"));
    this.pending.clear();
    for (const cb of this.closeListeners) cb();
  }
}
