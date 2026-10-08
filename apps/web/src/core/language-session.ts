import { JsonRpcConnection, LanguageClient, connectWebSocket } from "@cp-ide/lsp-client";
import { canonicalUri, fileModelPath, monaco, registerLanguageFeatures, toMarker } from "@cp-ide/editor";
import type { LanguageServerState } from "@cp-ide/plugin-api/web";
import type { LanguageServerInfo } from "@cp-ide/shared";

/** Edits are sent after a short pause; documents in this IDE are small, so full text is fine. */
const CHANGE_DELAY_MS = 150;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

export interface SessionEnvironment {
  /** Fresh server info (availability, initializationOptions), fetched before every connect. */
  fetchInfo(id: string): Promise<LanguageServerInfo | undefined>;
  /** Workspace folder for the server (absolute path), or null. */
  rootPath(): string | null;
  setState(id: string, state: LanguageServerState): void;
}

type OpenDocument = { model: monaco.editor.ITextModel; listener: monaco.IDisposable; timer?: ReturnType<typeof setTimeout> };

/**
 * The editor side of one language server: connects lazily, keeps open documents in sync, maps
 * diagnostics to markers and registers Monaco features. Reconnects (re-opening documents) when the
 * server process ends unexpectedly or is restarted.
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
    const entry: OpenDocument = { model, listener: { dispose() {} } };
    entry.listener = model.onDidChangeContent(() => {
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.client?.change(uri, model.getValue()), CHANGE_DELAY_MS);
    });
    this.documents.set(uri, entry);
    if (this.client) this.client.open(uri, model.getLanguageId(), model.getValue());
    else void this.connect();
  }

  close(model: monaco.editor.ITextModel) {
    const uri = model.uri.toString();
    const entry = this.documents.get(uri);
    if (!entry) return;
    clearTimeout(entry.timer);
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
    if (!info.available) return this.fail({ phase: "unavailable", error: info.error, hint: info.hint });
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
    this.env.setState(this.info.id, { phase: "ready" });
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

  private disconnect() {
    const client = this.client;
    this.client = null;
    this.features?.dispose();
    this.features = null;
    for (const { model } of this.documents.values()) monaco.editor.setModelMarkers(model, this.markerOwner, []);
    if (client) void client.stop();
    this.env.setState(this.info.id, { phase: "idle" });
  }
}
