import {
  type Disposable,
  type LanguageServerContribution,
  type LanguageServerResolution,
  type LanguageServersService,
  type PluginSocket,
  toDisposable,
} from "@cp-ide/plugin-api/server";
import type { LanguageServerInfo } from "@cp-ide/shared";
import { LanguageServerSession } from "./session.ts";

/**
 * Registry of language servers contributed by plugins, and the bridge between editor connections and
 * server processes. It knows nothing about any particular server.
 */
export class LanguageServerHost implements LanguageServersService, Disposable {
  private readonly servers = new Map<string, LanguageServerContribution>();
  private readonly sessions = new Map<string, Set<LanguageServerSession>>();

  constructor(
    /** Working directory for server processes. */
    private readonly cwd: () => string,
    private readonly log: (...args: unknown[]) => void = (...args) => console.log("[lsp]", ...args),
  ) {}

  register(server: LanguageServerContribution): Disposable {
    if (this.servers.has(server.id)) throw new Error(`Language server "${server.id}" is already registered`);
    this.servers.set(server.id, server);
    return toDisposable(() => {
      if (this.servers.get(server.id) !== server) return;
      this.servers.delete(server.id);
      this.stop(server.id);
    });
  }

  async list(): Promise<LanguageServerInfo[]> {
    return Promise.all(
      [...this.servers.values()].map(async (server) => {
        const res = await resolve(server);
        const base = { id: server.id, name: server.name, languages: server.languages };
        return res.ok
          ? { ...base, available: true as const, initializationOptions: res.launch.initializationOptions, configuration: res.launch.configuration }
          : { ...base, available: false as const, error: res.error, hint: res.hint, action: res.action };
      }),
    );
  }

  /** Bridge an editor connection to a new process of server `id`. */
  connect(id: string | null, socket: PluginSocket) {
    const session = new LanguageServerSession(socket, (...args) => this.log(`${id}:`, ...args));
    const server = id ? this.servers.get(id) : undefined;
    if (!server) return session.start(null, this.cwd());
    const running = this.sessions.get(server.id) ?? new Set();
    this.sessions.set(server.id, running);
    running.add(session);
    session.onEnd(() => running.delete(session));
    void resolve(server).then((res) => session.start(res.ok ? res.launch : null, this.cwd()));
  }

  /** Restart sessions whose server declared one of these settings in `restartOn`. */
  settingsChanged(keys: string[]) {
    for (const server of this.servers.values()) {
      if (server.restartOn?.some((key) => keys.includes(key))) this.stop(server.id);
    }
  }

  /** End every session of a server; editors reconnect to a fresh process. */
  stop(id: string) {
    for (const session of [...(this.sessions.get(id) ?? [])]) session.end();
  }

  dispose() {
    for (const id of this.sessions.keys()) this.stop(id);
  }
}

async function resolve(server: LanguageServerContribution): Promise<LanguageServerResolution> {
  try {
    return await server.resolve();
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}
