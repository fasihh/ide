/**
 * Web half of the plugin API — the surface a "tool" uses to extend the IDE.
 *
 * Everything the built-in UI does (explorer, editor, tests, output, settings) is itself
 * a plugin written against this API, so a new tool can do anything those can:
 * contribute panels, commands, keybindings, status bar / toolbar items and settings,
 * read and change the workspace (problems, files, tests), drive the runner, and listen
 * to events.
 */
import type { ComponentType } from "react";
import type { Hono } from "hono";
import type { hc } from "hono/client";
import type {
  CompileResult,
  CoreSettings,
  CreateProblemInput,
  ExecRequest,
  ExecResult,
  Language,
  LibraryItem,
  LibraryKind,
  Problem,
  ProblemMetaPatch,
  ProblemSummary,
  SettingDescriptor,
  SettingDescriptors,
  SettingValues,
  TestCase,
} from "@cp-ide/shared";
import type { Disposable } from "./common.ts";

export * from "./common.ts";

// ---------------------------------------------------------------------------
// Events

/**
 * Core events. Plugins can add their own by augmenting this interface:
 *
 *   declare module "@cp-ide/plugin-api/web" {
 *     interface CoreEvents { "stress:found": { input: string } }
 *   }
 */
export interface CoreEvents {
  "problem:opened": { problem: Problem };
  "problem:closed": { id: string };
  "file:saved": { problemId: string; file: string };
  "run:started": { testIds: string[] };
  "run:compiled": { result: CompileResult };
  "run:test-finished": { testId: string; result: ExecResult };
  "run:finished": { results: Record<string, ExecResult> };
  "settings:changed": { key: string; value: unknown };
  /** Files under the problems root changed (from the app or another program). */
  "problems:changed": { ids: string[] };
  /** The open problem was refreshed from disk after an external change. */
  "problem:reloaded": { problem: Problem };
}

export interface EventsApi {
  on<K extends keyof CoreEvents>(event: K, handler: (payload: CoreEvents[K]) => void): Disposable;
  emit<K extends keyof CoreEvents>(event: K, payload: CoreEvents[K]): void;
}

// ---------------------------------------------------------------------------
// State that plugins can read (and subscribe to with the `use` hooks)

export type Buffer = { content: string; saved: string };

export interface WorkspaceState {
  problems: ProblemSummary[];
  problemsLoading: boolean;
  /** Absolute path of the problems root (from settings, resolved by the server). */
  problemsRoot: string;
  /** The open problem. Its `files` reflect what is on disk; live edits are in `buffers`. */
  problem: Problem | null;
  buffers: Record<string, Buffer>;
  activeFile: string | null;
}

export type TestRunState =
  | { status: "idle" }
  | { status: "queued" }
  | { status: "running" }
  | { status: "done"; result: ExecResult };

export interface RunnerState {
  phase: "idle" | "compiling" | "running";
  compile: CompileResult | null;
  tests: Record<string, TestRunState>;
  /** Last "run with custom input" (not tied to a test). */
  custom: TestRunState;
}

/** A zustand-style store handle. `use` is a React hook. */
export interface StoreHandle<S> {
  get(): S;
  use<T>(selector: (state: S) => T): T;
  subscribe(listener: (state: S, prev: S) => void): Disposable;
}

// ---------------------------------------------------------------------------
// Services

export interface WorkspaceApi extends StoreHandle<WorkspaceState> {
  refreshProblems(): Promise<void>;
  openProblem(id: string): Promise<void>;
  closeProblem(): void;
  createProblem(input: CreateProblemInput): Promise<Problem>;
  createScratch(language?: Language): Promise<Problem>;
  /** Update a problem's metadata (default: the open problem). */
  updateMeta(patch: ProblemMetaPatch, id?: string): Promise<void>;
  /** Rename a problem (its folder is renamed too). Returns the new id. */
  renameProblem(id: string, name: string): Promise<string>;
  /** Move a problem to another platform / contest. Returns the new id. */
  moveProblem(id: string, target: { platform?: string; group?: string }): Promise<string>;
  /** Move a problem to the trash. Returns a trash id for `restoreProblem`. */
  deleteProblem(id: string): Promise<string>;
  restoreProblem(trashId: string): Promise<string>;

  setActiveFile(file: string): void;
  /** Update an open buffer (marks it dirty; auto save picks it up). */
  setBuffer(file: string, content: string): void;
  save(file?: string): Promise<void>;
  saveAll(): Promise<void>;

  /** Create a file in the open problem (.cpp/.py start from the template unless `content` is given). */
  createFile(name: string, content?: string): Promise<void>;
  /** Rename a file; renaming the main file keeps it the main file. */
  renameFile(from: string, to: string): Promise<void>;
  deleteFile(name: string): Promise<void>;

  addTest(test?: Partial<Omit<TestCase, "id">>): TestCase;
  updateTest(id: string, patch: Partial<Omit<TestCase, "id">>): void;
  removeTest(id: string): void;
  duplicateTest(id: string): TestCase | undefined;
  /** Move a test up (-1) or down (+1). */
  moveTest(id: string, delta: number): void;
}

export interface RunnerApi extends StoreHandle<RunnerState> {
  /** Compile the active problem's main file (cached by content). */
  compile(): Promise<CompileResult>;
  /** Run the given tests (default: all enabled tests) of the active problem. */
  run(testIds?: string[]): Promise<void>;
  /** Compile and run the main file on `input` without creating a test (result in `state.custom`). */
  runCustom(input: string): Promise<ExecResult | undefined>;
  /** Low level: run a compiled artifact on arbitrary input. */
  exec(req: ExecRequest): Promise<ExecResult>;
}

export interface SettingsApi {
  get<K extends keyof CoreSettings>(key: K): CoreSettings[K];
  /** React hook. */
  use<K extends keyof CoreSettings>(key: K): CoreSettings[K];
  set<K extends keyof CoreSettings>(key: K, value: CoreSettings[K]): Promise<void>;
  /**
   * Contribute settings (shown in the settings panel). Keys should be prefixed with the
   * plugin id. Returns a typed accessor for exactly these settings.
   */
  contribute<T extends SettingDescriptors>(descriptors: T): ScopedSettings<T>;
  /** React hook: every known setting (core + contributed) with current values — for settings UIs. */
  useSchema(): SettingsSchema;
  /** Write any keys at once (validated server-side when known). `null` resets a key to its default. */
  update(patch: Record<string, unknown>): Promise<void>;
}

export interface SettingsSchema {
  descriptors: Record<string, SettingDescriptor & { pluginId?: string }>;
  /** Effective values (defaults merged with overrides). */
  values: Record<string, unknown>;
  /** Only the keys the user changed. */
  overrides: Record<string, unknown>;
}

export interface ScopedSettings<T extends SettingDescriptors> extends Disposable {
  get<K extends keyof T & string>(key: K): SettingValues<T>[K];
  use<K extends keyof T & string>(key: K): SettingValues<T>[K];
  set<K extends keyof T & string>(key: K, value: SettingValues<T>[K]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Contributions

export type IconComponent = ComponentType<{ className?: string }>;

export interface PanelProps {
  ctx: WebPluginContext;
}

export interface PanelContribution {
  /** Globally unique; prefix with the plugin id for third-party plugins. */
  id: string;
  title: string;
  icon?: IconComponent;
  component: ComponentType<PanelProps>;
  /** Where the panel docks when opened. Defaults to "center". */
  placement?: "left" | "center" | "right" | "bottom";
  /** Included in the default layout. */
  defaultOpen?: boolean;
  /** Lower comes first within the same placement. */
  order?: number;
}

export interface CommandContribution {
  id: string;
  title: string;
  category?: string;
  /** e.g. "ctrl+enter", "ctrl+shift+p", "alt+1". `ctrl` also matches ⌘ on macOS. */
  keybinding?: string;
  run: (...args: any[]) => unknown;
}

export interface UiItemContribution {
  id: string;
  /** Lower comes first. */
  order?: number;
  component: ComponentType<PanelProps>;
}

/** A component rendered at the app root, above the layout (palettes, dialogs, HUDs). */
export interface OverlayContribution {
  id: string;
  component: ComponentType<PanelProps>;
}

/**
 * Plugin-to-plugin services. A plugin provides an object under a name; others look it up.
 * Export the service's type from the providing plugin so consumers can type `get<T>()`.
 */
export interface ServicesApi {
  provide<T extends object>(name: string, service: T): Disposable;
  get<T extends object>(name: string): T | undefined;
  /** Call `callback` once the service exists (immediately if it already does), whatever the activation order. */
  whenAvailable<T extends object>(name: string, callback: (service: T) => void): Disposable;
}

export interface StatusBarContribution extends UiItemContribution {
  align: "left" | "right";
}

/** A registered command with its effective keybinding (user override applied). */
export interface CommandInfo extends CommandContribution {
  /** The keybinding the command registered with, before user overrides. */
  defaultKeybinding?: string;
  pluginId: string;
}

export interface CommandsApi {
  register(command: CommandContribution): Disposable;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  list(): CommandInfo[];
  /** React hook version of `list`. */
  useList(): CommandInfo[];
  /** Override a command's keybinding (`""` = unbound, `null` = back to default). */
  setKeybinding(id: string, binding: string | null): Promise<void>;
  /** Capture the next key combination the user presses (Esc cancels → undefined). */
  recordKeybinding(): Promise<string | undefined>;
  /** "ctrl+shift+p" → "Ctrl+Shift+P" (⌘ on macOS). */
  formatKeybinding(binding: string): string;
}

export interface PanelsApi {
  register(panel: PanelContribution): Disposable;
  open(id: string): void;
  close(id: string): void;
  toggle(id: string): void;
  /** Whether a panel is currently open in the layout. */
  isOpen(id: string): boolean;
  /** React hook version of `isOpen`. */
  useIsOpen(id: string): boolean;
  list(): PanelContribution[];
}

export interface LayoutPreset {
  id: string;
  name: string;
  description?: string;
  /** Panels to open, laid out by their placements. Everything else is closed. */
  panels: string[];
}

export interface LayoutApi {
  /** Built-in, plugin and user-saved presets. */
  listPresets(): (LayoutPreset & { saved?: boolean })[];
  registerPreset(preset: LayoutPreset): Disposable;
  applyPreset(id: string): void;
  /** Save the current arrangement (sizes included) under `name`. */
  saveCurrent(name: string): void;
  deleteSaved(id: string): void;
  reset(): void;
}

export interface QuickPickItem<T> {
  label: string;
  description?: string;
  detail?: string;
  /** Shown right-aligned (e.g. a keybinding). */
  hint?: string;
  value: T;
}

export interface UiApi {
  /** Fuzzy-filterable picker (like VS Code's quick pick). Resolves undefined when dismissed. */
  quickPick<T>(items: QuickPickItem<T>[], options?: { placeholder?: string; title?: string }): Promise<T | undefined>;
  /** Single-line text prompt. `validate` returns an error message or undefined. */
  prompt(options: { title: string; placeholder?: string; value?: string; validate?: (v: string) => string | undefined }): Promise<string | undefined>;
  confirm(options: { title: string; message?: string; confirmLabel?: string; destructive?: boolean }): Promise<boolean>;
}

export interface NotifyAction {
  label: string;
  run: () => unknown;
}

export interface NotifyApi {
  info(message: string, description?: string, action?: NotifyAction): void;
  success(message: string, description?: string, action?: NotifyAction): void;
  error(message: string, description?: string, action?: NotifyAction): void;
}

/** Templates (new problems/files start from them) and snippets (inserted into the editor). */
export interface LibraryApi {
  list(kind: LibraryKind): Promise<LibraryItem[]>;
  /** React hook: cached list, loaded on first use and refreshed after changes. */
  use(kind: LibraryKind): LibraryItem[] | undefined;
  save(kind: LibraryKind, name: string, content: string): Promise<void>;
  create(kind: LibraryKind, name: string, content?: string): Promise<void>;
  rename(kind: LibraryKind, from: string, to: string): Promise<void>;
  remove(kind: LibraryKind, name: string): Promise<void>;
}

export interface PluginInfo {
  id: string;
  name: string;
  description?: string;
  required?: boolean;
  enabled: boolean;
  /** Whether the plugin has a server half. */
  hasServer: boolean;
}

// Hono generics are intentionally loose here.
export type RpcClient<T extends Hono<any, any, any>> = ReturnType<typeof hc<T>>;

export interface WebPluginContext {
  readonly pluginId: string;
  readonly workspace: WorkspaceApi;
  readonly runner: RunnerApi;
  readonly settings: SettingsApi;
  readonly commands: CommandsApi;
  readonly panels: PanelsApi;
  readonly statusBar: { register(item: StatusBarContribution): Disposable };
  readonly toolbar: { register(item: UiItemContribution): Disposable };
  readonly overlays: { register(overlay: OverlayContribution): Disposable };
  readonly services: ServicesApi;
  readonly events: EventsApi;
  readonly layout: LayoutApi;
  readonly library: LibraryApi;
  readonly ui: UiApi;
  readonly notify: NotifyApi;
  /** The resolved color theme ("system" already applied). `use` is a React hook. */
  readonly theme: { get(): "dark" | "light"; use(): "dark" | "light" };
  readonly plugins: { list(): PluginInfo[] };
  /**
   * Typed client for this plugin's server routes:
   *   const api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();
   */
  rpc<T extends Hono<any, any, any>>(): RpcClient<T>;
}

export interface WebPlugin {
  id: string;
  name: string;
  description?: string;
  /** Required plugins cannot be disabled from settings. */
  required?: boolean;
  activate(ctx: WebPluginContext): void | Disposable | Promise<void | Disposable>;
}

export function definePlugin(plugin: WebPlugin): WebPlugin {
  return plugin;
}

export type { PluginRoutes } from "./server.ts";
