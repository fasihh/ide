/**
 * Server half of the plugin API. A server plugin can:
 *  - expose typed Hono routes, mounted at `/api/plugins/<id>` (call them from the
 *    plugin's web half with `ctx.rpc<PluginRoutes<typeof plugin>>()`)
 *  - use core services (settings, problems, runner)
 *  - react to server hooks (problem created, compile finished, ...)
 */
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

export interface RunnerService {
  compile(req: CompileRequest): Promise<CompileResult>;
  exec(req: ExecRequest): Promise<ExecResult>;
  interact(req: InteractRequest): Promise<ExecResult>;
}

export interface ServerPluginContext {
  readonly pluginId: string;
  /** A private folder this plugin may write to (`~/.cp-ide/plugins/<id>`). */
  readonly dataDir: string;
  readonly settings: SettingsService;
  readonly problems: ProblemsService;
  readonly library: LibraryService;
  readonly runner: RunnerService;
  on<K extends keyof ServerEvents>(event: K, handler: (payload: ServerEvents[K]) => void): Disposable;
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

/** Route type of a server plugin, for `hc<PluginRoutes<typeof plugin>>()`. */
export type PluginRoutes<P> = P extends ServerPlugin<infer R> ? R : never;
