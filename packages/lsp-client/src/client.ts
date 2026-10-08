import type {
  ClientCapabilities,
  ConfigurationParams,
  Diagnostic,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
  ServerCapabilities,
  TextEdit,
} from "vscode-languageserver-protocol";
import { applyTextEdits } from "./edits.ts";
import type { Disposable, JsonRpcConnection } from "./jsonrpc.ts";

export interface LanguageClientOptions {
  /** Shown to the server as `clientInfo.name`. */
  clientName: string;
  /** The workspace folder (a file URI), or null. */
  rootUri: string | null;
  initializationOptions?: unknown;
  /**
   * Settings tree for `workspace/configuration`, nested like VS Code settings: a request for section
   * `"basedpyright.analysis"` or `"basedpyright"` gets the matching subtree; unknown sections get null.
   */
  configuration?: Record<string, unknown>;
}

/** What the editor integration supports — servers tailor their responses to this. */
const CLIENT_CAPABILITIES: ClientCapabilities = {
  general: { positionEncodings: ["utf-16"] },
  textDocument: {
    synchronization: { didSave: false, dynamicRegistration: false },
    completion: {
      contextSupport: true,
      completionItem: {
        snippetSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        labelDetailsSupport: true,
        resolveSupport: { properties: ["documentation", "detail"] },
      },
    },
    hover: { contentFormat: ["markdown", "plaintext"] },
    signatureHelp: {
      contextSupport: true,
      signatureInformation: { documentationFormat: ["markdown", "plaintext"], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true },
    },
    definition: { linkSupport: false },
    references: {},
    rename: { prepareSupport: true },
    formatting: {},
    inlayHint: {},
    publishDiagnostics: { relatedInformation: false },
  },
  workspace: { configuration: true, workspaceFolders: true, inlayHint: { refreshSupport: true } },
  window: { workDoneProgress: false },
};

/**
 * An LSP client over a JSON-RPC connection: the initialize handshake, full-text document sync and
 * diagnostics. Feature requests (completion, hover, ...) go through `request`.
 */
export class LanguageClient implements Disposable {
  private serverCapabilities: ServerCapabilities = {};
  private readonly versions = new Map<string, number>();
  private readonly diagnosticsListeners: ((uri: string, diagnostics: Diagnostic[]) => void)[] = [];
  private readonly requestListeners: (() => void)[] = [];

  constructor(
    readonly connection: JsonRpcConnection,
    private readonly options: LanguageClientOptions,
  ) {
    connection.onNotification<PublishDiagnosticsParams>("textDocument/publishDiagnostics", ({ uri, diagnostics }) => {
      for (const cb of this.diagnosticsListeners) cb(uri, diagnostics);
    });
    // Requests servers commonly send; this client has no settings or dynamic registration.
    connection.onRequest<ConfigurationParams>("workspace/configuration", ({ items }) => items.map(({ section }) => configurationSection(options.configuration, section)));
    connection.onRequest("client/registerCapability", () => null);
    connection.onRequest("client/unregisterCapability", () => null);
    connection.onRequest("window/workDoneProgress/create", () => null);
    connection.onRequest("workspace/workspaceFolders", () => this.workspaceFolders());
  }

  get capabilities(): ServerCapabilities {
    return this.serverCapabilities;
  }

  async start(): Promise<void> {
    const params: InitializeParams = {
      processId: null,
      clientInfo: { name: this.options.clientName },
      rootUri: this.options.rootUri,
      workspaceFolders: this.workspaceFolders(),
      capabilities: CLIENT_CAPABILITIES,
      initializationOptions: this.options.initializationOptions,
    };
    const result = await this.connection.request<InitializeResult>("initialize", params);
    this.serverCapabilities = result.capabilities;
    this.connection.notify("initialized", {});
  }

  open(uri: string, languageId: string, text: string) {
    this.versions.set(uri, 1);
    this.connection.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
  }

  /** Replace the whole document (valid for both full and incremental servers). */
  change(uri: string, text: string) {
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    this.connection.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
  }

  /** `text` (the document's current content) formatted by the server, or null if it cannot format. */
  async format(uri: string, text: string, options: { tabSize: number; insertSpaces: boolean }): Promise<string | null> {
    if (!this.serverCapabilities.documentFormattingProvider || !this.isOpen(uri)) return null;
    const edits = await this.request<TextEdit[] | null>("textDocument/formatting", { textDocument: { uri }, options });
    return applyTextEdits(text, edits ?? []);
  }

  close(uri: string) {
    if (!this.versions.delete(uri)) return;
    this.connection.notify("textDocument/didClose", { textDocument: { uri } });
  }

  isOpen(uri: string) {
    return this.versions.has(uri);
  }

  request<R>(method: string, params: unknown, signal?: AbortSignal): Promise<R> {
    for (const cb of this.requestListeners) cb();
    return this.connection.request<R>(method, params, signal);
  }

  /** Called whenever the editor asks the server something (completion, hover…) — e.g. to track idleness. */
  onRequest(cb: () => void): Disposable {
    this.requestListeners.push(cb);
    return { dispose: () => this.requestListeners.splice(this.requestListeners.indexOf(cb), 1) };
  }

  onDiagnostics(cb: (uri: string, diagnostics: Diagnostic[]) => void): Disposable {
    this.diagnosticsListeners.push(cb);
    return { dispose: () => this.diagnosticsListeners.splice(this.diagnosticsListeners.indexOf(cb), 1) };
  }

  /** Polite shutdown, then close the connection whether or not the server answered. */
  async stop() {
    try {
      await Promise.race([this.connection.request("shutdown"), new Promise((r) => setTimeout(r, 1000))]);
      this.connection.notify("exit");
    } catch {
      // already gone
    }
    this.dispose();
  }

  dispose() {
    this.connection.dispose();
  }

  private workspaceFolders() {
    return this.options.rootUri ? [{ uri: this.options.rootUri, name: "workspace" }] : null;
  }
}

/** The subtree at a dotted section path (`"a.b"` → `config.a.b`); the whole tree for no section. */
export function configurationSection(config: Record<string, unknown> | undefined, section: string | undefined): unknown {
  if (!config) return null;
  if (!section) return config;
  let node: unknown = config;
  for (const key of section.split(".")) {
    if (typeof node !== "object" || node === null || !(key in node)) return null;
    node = (node as Record<string, unknown>)[key];
  }
  return node ?? null;
}
