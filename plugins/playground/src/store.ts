import { create } from "zustand";
import { type PluginRoutes, type RpcClient, type WebPluginContext, unwrap } from "@cp-ide/plugin-api/web";
import type serverPlugin from "./server.ts";
import type { ClientMessage, ServerMessage } from "./shared.ts";

export type PlaygroundFile = { name: string; language: "cpp" | "python"; content: string; saved: string };

export type RunStatus =
  | { phase: "idle" }
  | { phase: "compiling"; file: string }
  | { phase: "running"; file: string; since: number }
  | { phase: "exited"; file: string; exitCode: number | null; timeMs: number; message?: string }
  | { phase: "compile-error"; file: string };

export const usePlayground = create<{
  loaded: boolean;
  folder: string;
  files: PlaygroundFile[];
  active: string | null;
  run: RunStatus;
}>(() => ({ loaded: false, folder: "", files: [], active: null, run: { phase: "idle" } }));

const set = usePlayground.setState;
const get = usePlayground.getState;
const ACTIVE_KEY = "cp-ide.playground.active";
const SAVE_DELAY = 600;

type Api = RpcClient<PluginRoutes<typeof serverPlugin>>;
let api: Api;
let notify: WebPluginContext["notify"];

export function initStore(ctx: WebPluginContext) {
  api = ctx.rpc<PluginRoutes<typeof serverPlugin>>();
  notify = ctx.notify;
}

function applyList(res: { folder: string; files: { name: string; language: "cpp" | "python"; content: string }[] }) {
  const prev = new Map(get().files.map((f) => [f.name, f]));
  const files = res.files.map((f) => {
    const old = prev.get(f.name);
    // Keep unsaved edits when refreshing.
    return old && old.content !== old.saved ? { ...f, content: old.content, saved: f.content } : { ...f, saved: f.content };
  });
  const remembered = (() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  })();
  const cur = get().active ?? remembered;
  const active = files.some((f) => f.name === cur) ? cur : (files[0]?.name ?? null);
  set({ loaded: true, folder: res.folder, files, active });
}

export async function loadFiles() {
  applyList(await unwrap(api.files.$get()));
}

export function setActive(name: string) {
  set({ active: name });
  try {
    localStorage.setItem(ACTIVE_KEY, name);
  } catch {}
}

export const activeFile = () => get().files.find((f) => f.name === get().active);

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function setContent(name: string, content: string) {
  set((s) => ({ files: s.files.map((f) => (f.name === name ? { ...f, content } : f)) }));
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => void saveFile(name), SAVE_DELAY));
}

export async function saveFile(name = get().active ?? "") {
  clearTimeout(timers.get(name));
  const f = get().files.find((x) => x.name === name);
  if (!f || f.content === f.saved) return;
  const content = f.content;
  try {
    await unwrap(api.file.$put({ json: { name, content } }));
    set((s) => ({ files: s.files.map((x) => (x.name === name ? { ...x, saved: content } : x)) }));
  } catch (err) {
    notify.error("Could not save playground file", String(err));
  }
}

export async function createFile(name: string, content?: string) {
  applyList(await unwrap(api.create.$post({ json: { name, content } })));
  setActive(name);
}

export async function renameFile(from: string, to: string) {
  await saveFile(from);
  applyList(await unwrap(api.rename.$post({ json: { from, to } })));
  if (get().active === from) setActive(to);
}

export async function deleteFile(name: string) {
  clearTimeout(timers.get(name));
  applyList(await unwrap(api.delete.$post({ json: { name } })));
}

// ---------------------------------------------------------------------------
// Terminal output: kept as a log so the terminal can replay it when (re)mounted.

export type TerminalSink = { write(text: string): void; clear(): void };
const LOG_LIMIT = 2000;
let log: string[] = [];
let sink: TerminalSink | null = null;

export function attachTerminal(s: TerminalSink | null) {
  sink = s;
  if (s) for (const chunk of log) s.write(chunk);
}

export function termWrite(text: string) {
  log.push(text);
  if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT);
  sink?.write(text);
}

export function termClear() {
  log = [];
  sink?.clear();
}

export const ansi = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Run socket

let socket: WebSocket | null = null;
let queue: ClientMessage[] = [];

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return socket;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/plugins/playground/run`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    for (const m of queue) ws.send(JSON.stringify(m));
    queue = [];
  };
  ws.onmessage = (e) => handle(JSON.parse(String(e.data)) as ServerMessage);
  ws.onclose = () => {
    if (socket === ws) socket = null;
    const run = get().run;
    if (run.phase === "running" || run.phase === "compiling") {
      termWrite(ansi.red("\r\n[connection to the server lost]\r\n"));
      set({ run: { phase: "idle" } });
    }
  };
  return ws;
}

function send(m: ClientMessage) {
  const ws = connect();
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else queue.push(m);
}

function handle(m: ServerMessage) {
  const run = get().run;
  const file = "file" in run ? run.file : "";
  switch (m.type) {
    case "compiling":
      set({ run: { phase: "compiling", file } });
      termWrite(ansi.dim("Compiling…\r\n"));
      break;
    case "compiled":
      if (!m.ok) {
        termWrite(ansi.red(`${m.stderr.replace(/\n/g, "\r\n")}\r\nCompilation failed\r\n`));
        set({ run: { phase: "compile-error", file } });
      } else {
        if (m.stderr.trim()) termWrite(ansi.dim(`${m.stderr.trim().replace(/\n/g, "\r\n")}\r\n`));
        if (!m.cached) termWrite(ansi.dim(`(compiled in ${m.timeMs} ms)\r\n`));
      }
      break;
    case "started":
      set({ run: { phase: "running", file, since: Date.now() } });
      break;
    case "stdout":
      termWrite(m.data);
      break;
    case "stderr":
      termWrite(ansi.red(m.data));
      break;
    case "exit": {
      const ok = m.exitCode === 0 && !m.message;
      const summary = `exited with code ${m.exitCode ?? "–"} · ${m.timeMs} ms${m.message ? ` · ${m.message}` : ""}`;
      termWrite(`\r\n${ok ? ansi.dim(`— ${summary}`) : ansi.red(`— ${summary}`)}\r\n`);
      set({ run: { phase: "exited", file, exitCode: m.exitCode, timeMs: m.timeMs, message: m.message } });
      break;
    }
    case "error":
      termWrite(ansi.red(`${m.message}\r\n`));
      set({ run: { phase: "idle" } });
      break;
  }
}

/** Compile and run `source` in the terminal. */
export function runSource(fileName: string, source: string) {
  const language = fileName.endsWith(".py") ? "python" : "cpp";
  termClear();
  termWrite(ansi.dim(`▶ ${fileName}\r\n`));
  set({ run: { phase: "compiling", file: fileName } });
  send({ type: "start", language, source, fileName });
}

export const isRunning = () => get().run.phase === "running";
export const sendStdin = (data: string) => send({ type: "stdin", data });
export const sendEof = () => send({ type: "eof" });
export const stopRun = () => send({ type: "kill" });
