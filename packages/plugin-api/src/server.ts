/**
 * Server half of the plugin API. A server plugin can:
 *  - expose typed Hono routes, mounted at `/api/plugins/<id>` (call them from the
 *    plugin's web half with `ctx.rpc<PluginRoutes<typeof plugin>>()`)
 *  - use core services (settings, problems, runner)
 *  - react to server hooks (problem created, compile finished, ...)
 */
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Hono } from "hono";
import type {
  LibraryItem,
  LibraryKind,
  CompileRequest,
  CompileResult,
  CoreSettings,
  CreateProblemInput,
  ExecRequest,
  InteractRequest,
  Language,
  ExecResult,
  Problem,
  ProblemMetaPatch,
  ProblemSummary,
  SettingDescriptors,
  TestCase,
} from "@cp-ide/shared";
import type { Disposable } from "./common.ts";

export * from "./common.ts";

export interface ServerEvents {
  "problem:created": { problem: Problem };
  "problem:updated": { id: string };
  "compile:done": { request: CompileRequest; result: CompileResult };
  "settings:changed": { changed: Partial<CoreSettings> & Record<string, unknown> };
  /** Files under the problems root changed (debounced). `ids` are affected problem folders. */
  "problems:changed": { ids: string[] };
}

export interface SettingsService {
  get<K extends keyof CoreSettings>(key: K): CoreSettings[K];
  /** Read any key, including plugin-contributed ones. */
  getRaw(key: string): unknown;
  all(): Record<string, unknown>;
}

export interface ProblemsService {
  root(): string;
  list(): Promise<ProblemSummary[]>;
  get(id: string): Promise<Problem>;
  create(input: CreateProblemInput): Promise<Problem>;
  createScratch(language?: Problem["meta"]["language"]): Promise<Problem>;
  updateMeta(id: string, patch: ProblemMetaPatch): Promise<Problem["meta"]>;
  writeFile(id: string, file: string, content: string): Promise<void>;
  writeTests(id: string, tests: TestCase[]): Promise<void>;
  createFile(id: string, file: string, content?: string): Promise<void>;
  deleteFile(id: string, file: string): Promise<void>;
  renameFile(id: string, from: string, to: string): Promise<void>;
  /** Rename/move: the folder follows platform/group/name. Returns the problem under its new id. */
  move(id: string, target: { name?: string; platform?: string; group?: string }): Promise<Problem>;
  /** Move to `<root>/.trash`; returns a trash id for `restore`. */
  trash(id: string): Promise<string>;
  restore(trashId: string): Promise<Problem>;
  /** Absolute folder of a problem. */
  dir(id: string): string;
}

export interface LibraryService {
  list(kind: LibraryKind): Promise<LibraryItem[]>;
  read(kind: LibraryKind, name: string): Promise<string | null>;
  save(kind: LibraryKind, name: string, content: string): Promise<void>;
}

/** A running program with streaming I/O (see `RunnerService.start`). */
export interface ProcessSession {
  write(data: string): void;
  /** Close stdin (EOF). */
  end(): void;
  kill(): void;
  onStdout(cb: (data: string) => void): void;
  onStderr(cb: (data: string) => void): void;
  /** `message` explains abnormal exits (crash, killed, time/output limit). */
  onExit(cb: (info: { exitCode: number | null; timeMs: number; message?: string }) => void): void;
}

/** A compiled program, as the runner knows it after `compile`. */
export type Program =
  | { language: "cpp"; executable: string; source: string }
  | { language: "python"; interpreter: string; flags: string[]; script: string };

/** Where and how a program is started. */
export interface LaunchOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Starts live sessions (`RunnerService.start`) in a custom way, e.g. a pre-warmed interpreter.
 * Launchers are asked in registration order; the first non-null child wins, otherwise the runner
 * spawns the program directly. The returned child must have piped stdin/stdout/stderr.
 */
export interface ProcessLauncher {
  readonly id: string;
  launch(program: Program, opts: LaunchOptions): ChildProcessWithoutNullStreams | null;
}

export interface RunnerService {
  compile(req: CompileRequest): Promise<CompileResult>;
  exec(req: ExecRequest): Promise<ExecResult>;
  interact(req: InteractRequest): Promise<ExecResult>;
  /**
   * Start a compiled artifact with live stdin/stdout (for terminals). `maxRunMs` = 0 means no limit.
   * Returns null for an unknown artifact (compile first).
   */
  start(artifactId: string, opts?: { maxRunMs?: number; outputLimit?: number }): ProcessSession | null;
  /** Let a plugin start live sessions (see `ProcessLauncher`). Tests (`exec`/`interact`) never use launchers. */
  registerLauncher(launcher: ProcessLauncher): Disposable;
}

/** How to start a language server process (it must speak LSP over stdio). */
export interface LanguageServerLaunch {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Sent by the editor in the LSP `initialize` request. */
  initializationOptions?: unknown;
  /** Answers to the server's `workspace/configuration` requests, by section (e.g. `"python"`). */
  configuration?: Record<string, unknown>;
}

export type LanguageServerResolution = { ok: true; launch: LanguageServerLaunch } | { ok: false; error: string; hint?: string };

/**
 * A language server a plugin provides. Core owns everything else: the editor's LSP client, document
 * sync, Monaco features, process lifetime and the status bar.
 */
export interface LanguageServerContribution {
  /** Also the id shown in the status bar and used by `/api/lsp?server=<id>`. */
  id: string;
  name: string;
  languages: Language[];
  /** How to start the server now. Called before every start, so settings changes apply on restart. */
  resolve(): Promise<LanguageServerResolution>;
  /** Setting keys whose change restarts running sessions of this server (editors reconnect). */
  restartOn?: string[];
}

export interface LanguageServersService {
  register(server: LanguageServerContribution): Disposable;
}

/** A WebSocket connection handed to a plugin's `websocket()` handler. Messages are text. */
export interface PluginSocket {
  send(data: string): void;
  close(): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
}

export interface ServerPluginContext {
  readonly pluginId: string;
  /** A private folder this plugin may write to (`~/.cp-ide/plugins/<id>`). */
  readonly dataDir: string;
  readonly settings: SettingsService;
  readonly problems: ProblemsService;
  readonly library: LibraryService;
  readonly runner: RunnerService;
  readonly languageServers: LanguageServersService;
  on<K extends keyof ServerEvents>(event: K, handler: (payload: ServerEvents[K]) => void): Disposable;
  /** Accept WebSocket connections at `/api/plugins/<id>/<path>`. */
  websocket(path: string, handler: (socket: PluginSocket) => void): Disposable;
  log(...args: unknown[]): void;
}

// Hono generics are intentionally loose here.
type AnyHono = Hono<any, any, any>;

export interface ServerPlugin<R extends AnyHono = AnyHono> {
  id: string;
  name: string;
  description?: string;
  /** Settings this plugin contributes (keys should be prefixed with the plugin id). */
  settings?: SettingDescriptors;
  routes?: (ctx: ServerPluginContext) => R;
  setup?: (ctx: ServerPluginContext) => void | Disposable | Promise<void | Disposable>;
}

export function defineServerPlugin<R extends AnyHono = AnyHono>(plugin: ServerPlugin<R>): ServerPlugin<R> {
  return plugin;
}
