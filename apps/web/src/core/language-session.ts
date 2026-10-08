import { JsonRpcConnection, LanguageClient, connectWebSocket } from "@cp-ide/lsp-client";
import { canonicalUri, fileModelPath, monaco, registerLanguageFeatures, toMarker } from "@cp-ide/editor";
import type { LanguageServerState } from "@cp-ide/plugin-api/web";
import type { LanguageServerInfo } from "@cp-ide/shared";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

export interface SessionEnvironment {
  /** Fresh server info (availability, initializationOptions), fetched before every connect. */
  fetchInfo(id: string): Promise<LanguageServerInfo | undefined>;
  /** Workspace folder for the server (absolute path), or null. */
  rootPath(): string | null;
  /** Stop the server after this long without edits or requests (it restarts on demand); 0 = never. */
  idleMs(): number;
  setState(id: string, state: LanguageServerState): void;
}

type OpenDocument = { model: monaco.editor.ITextModel; listener: monaco.IDisposable };

/**
 * The editor side of one language server: connects lazily, keeps open documents in sync, maps
 * diagnostics to markers and registers Monaco features. Reconnects (re-opening documents) when the
 * server process ends unexpectedly or is restarted, and stops it after a while without use — the next
 * edit or editor focus (`wake`) starts it again.
 */
export class LanguageServerSession {
  private client: LanguageClient | null = null;
  private features: monaco.IDisposable | null = null;
  private connecting: Promise<void> | null = null;
  private readonly documents = new Map<string, OpenDocument>();
  private attempts = 0;
  private stopped = false;
  /** Unavailable, or out of reconnect attempts: waiting for `retryIfFailed` or `restart`. */
  private failed = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly info: LanguageServerInfo,
    private readonly env: SessionEnvironment,
  ) {}

  get id() {
    return this.info.id;
  }

  private get markerOwner() {
    return `lsp:${this.info.id}`;
  }

  /** Track a model; the server is started on the first one. */
  open(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    if (this.documents.has(uri)) return;
    // Every edit is sent at once (full text; documents here are small). Monaco fires this before it
    // asks for completions, so a request after typing "." always sees the "." — a delayed sync made
    // `np.` complete against the old text and offer global names instead of numpy's members.
    const listener = model.onDidChangeContent(() => {
      if (!this.client) return this.wake(); // connecting opens every document with its current text
      this.client.change(uri, model.getValue());
      this.touch();
    });
    this.documents.set(uri, { model, listener });
    if (this.client) this.client.open(uri, model.getLanguageId(), model.getValue());
    else void this.connect();
  }

  /** Start the server again if it was stopped for being idle and a document still needs it. */
  wake() {
    if (!this.client && !this.failed && !this.stopped && this.documents.size) void this.connect();
  }

  /** A tracked document formatted by this server, or null if it cannot format it. */
  async format(model: monaco.editor.ITextModel, options: { tabSize: number; insertSpaces: boolean }): Promise<string | null> {
    const uri = model.uri.toString();
    if (!this.documents.has(uri)) return null;
    if (!this.client) await this.connect();
    try {
      return (await this.client?.format(uri, model.getValue(), options)) ?? null;
    } catch {
      return null;
    }
  }

  close(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    const entry = this.documents.get(uri);
    if (!entry) return;
    entry.listener.dispose();
    this.documents.delete(uri);
    this.client?.close(uri);
    if (!model.isDisposed()) monaco.editor.setModelMarkers(model, this.markerOwner, []);
  }

  /** Try again after a failure (e.g. the user fixed a setting). */
  retryIfFailed() {
    if (this.failed) this.restart();
  }

  /** Drop the connection and start a fresh server process. */
  restart() {
    this.failed = false;
    this.attempts = 0;
    this.disconnect();
    if (this.documents.size) void this.connect();
  }

  dispose() {
    this.stopped = true;
    for (const { model } of [...this.documents.values()]) this.close(model);
    this.disconnect();
  }

  private connect(): Promise<void> {
    this.connecting ??= this.doConnect().finally(() => (this.connecting = null));
    return this.connecting;
  }

  private async doConnect() {
    const info = await this.env.fetchInfo(this.info.id);
    if (!info) return this.fail({ phase: "error", error: "No longer registered" });
    if (!info.available) return this.fail({ phase: "unavailable", error: info.error, hint: info.hint, action: info.action });
    this.env.setState(this.info.id, { phase: "starting" });
    let client: LanguageClient;
    try {
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      const transport = await connectWebSocket(`${protocol}://${location.host}/api/lsp?server=${encodeURIComponent(info.id)}`);
      const root = this.env.rootPath();
      client = new LanguageClient(new JsonRpcConnection(transport), {
        clientName: "cp-ide",
        rootUri: root ? fileModelPath(root) : null,
        initializationOptions: info.initializationOptions,
        configuration: info.configuration,
      });
      client.connection.onClose(() => this.handleClose(client));
      await client.start();
    } catch (err) {
      return this.retry(String((err as Error)?.message ?? err));
    }
    if (this.stopped) return client.dispose();
    this.client = client;
    this.attempts = 0;
    client.onDiagnostics((uri, diagnostics) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(canonicalUri(uri)));
      if (model) monaco.editor.setModelMarkers(model, this.markerOwner, diagnostics.map(toMarker));
    });
    this.features = registerLanguageFeatures(client, this.info.languages);
    for (const [uri, { model }] of this.documents) client.open(uri, model.getLanguageId(), model.getValue());
    client.onRequest(() => this.touch());
    this.touch();
    this.env.setState(this.info.id, { phase: "ready" });
  }

  /** Something used the server: push its idle shutdown back. */
  private touch() {
    clearTimeout(this.idleTimer);
    const idleMs = this.env.idleMs();
    if (idleMs > 0) this.idleTimer = setTimeout(() => this.disconnect({ keepMarkers: true }), idleMs);
  }

  private handleClose(client: LanguageClient) {
    if (this.client !== client) return; // a connection we already replaced or dropped
    this.disconnect();
    if (!this.stopped && this.documents.size) this.retry("The language server stopped");
  }

  private retry(error: string) {
    const delay = RECONNECT_DELAYS_MS[this.attempts++];
    if (delay === undefined) return this.fail({ phase: "error", error });
    this.env.setState(this.info.id, { phase: "starting" });
    setTimeout(() => {
      if (!this.stopped && this.documents.size) void this.connect();
    }, delay);
  }

  private fail(state: Extract<LanguageServerState, { phase: "error" | "unavailable" }>) {
    this.failed = true;
    this.env.setState(this.info.id, state);
  }

  /** `keepMarkers`: an idle stop leaves the last diagnostics up — they are still right until the next edit. */
  private disconnect({ keepMarkers = false } = {}) {
    const client = this.client;
    this.client = null;
    clearTimeout(this.idleTimer);
    this.features?.dispose();
    this.features = null;
    if (!keepMarkers) for (const { model } of this.documents.values()) monaco.editor.setModelMarkers(model, this.markerOwner, []);
    if (client) void client.stop();
    this.env.setState(this.info.id, { phase: "idle" });
  }
}
