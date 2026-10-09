import { create } from "zustand";
import { fileModelPath, monaco } from "@cp-ide/editor";
import type { LanguageServerState, LanguageServersApi } from "@cp-ide/plugin-api/web";
import type { LanguageServerInfo } from "@cp-ide/shared";
import { api, unwrap } from "../api.ts";
import { LanguageServerSession } from "./language-session.ts";
import { getSetting, useSettings } from "./settings.ts";
import { useWorkspace } from "./workspace.ts";

const useLanguageServers = create<{ infos: LanguageServerInfo[]; states: Record<string, LanguageServerState> }>(() => ({ infos: [], states: {} }));

const sessions = new Map<string, LanguageServerSession>();

const fetchInfos = () => unwrap(api.lsp.servers.$get());

const environment = {
  async fetchInfo(id: string) {
    const infos = await fetchInfos().catch(() => useLanguageServers.getState().infos);
    useLanguageServers.setState({ infos });
    return infos.find((i) => i.id === id);
  },
  rootPath: () => useWorkspace.getState().problemsRoot || null,
  idleMs: () => getSetting("editor.languageServerIdleMinutes") * 60_000,
  setState: (id: string, state: LanguageServerState) => useLanguageServers.setState((s) => ({ states: { ...s.states, [id]: state } })),
};

/** Language servers attach to editors showing real files (`file:` model URIs) in their languages. */
const sessionFor = (model: monaco.editor.ITextModel) =>
  model.uri.scheme === "file" ? sessions.get(useLanguageServers.getState().infos.find((i) => i.languages.includes(model.getLanguageId() as never))?.id ?? "") : undefined;

/** The session each tracked model is open in. */
const assigned = new Map<monaco.editor.ITextModel, LanguageServerSession | undefined>();

/** Move a model to the session that should hold it now (servers or its language may have changed). */
function assign(model: monaco.editor.ITextModel) {
  const next = sessionFor(model);
  const current = assigned.get(model);
  if (current === next) return;
  current?.close(model);
  next?.open(model);
  assigned.set(model, next);
}

function track(model: monaco.editor.ITextModel) {
  assign(model);
  const languageChange = model.onDidChangeLanguage(() => assign(model));
  model.onWillDispose(() => {
    languageChange.dispose();
    assigned.get(model)?.close(model);
    assigned.delete(model);
  });
}

/**
 * Follow the servers registered right now (a plugin providing one was turned on or off): sessions of
 * removed servers are disposed — their processes stop — and editors attach to new ones.
 */
export async function refreshLanguageServers() {
  const infos = await fetchInfos().catch(() => null);
  if (!infos) return;
  const ids = new Set(infos.map((i) => i.id));
  for (const [id, session] of sessions) {
    if (ids.has(id)) continue;
    session.dispose();
    sessions.delete(id);
  }
  for (const info of infos) if (!sessions.has(info.id)) sessions.set(info.id, new LanguageServerSession(info, environment));
  useLanguageServers.setState((s) => ({
    infos,
    states: Object.fromEntries(infos.map((i) => [i.id, s.states[i.id] ?? initialState(i)])),
  }));
  for (const model of assigned.keys()) assign(model);
}

const initialState = (i: LanguageServerInfo): LanguageServerState =>
  i.available ? { phase: "idle" } : { phase: "unavailable", error: i.error, hint: i.hint, action: i.action };

/** Load the registered servers and start following editor models. Call once at startup. */
export async function installLanguageServers() {
  const infos = await fetchInfos().catch(() => [] as LanguageServerInfo[]);
  useLanguageServers.setState({
    infos,
    states: Object.fromEntries(infos.map((i) => [i.id, initialState(i)])),
  });
  for (const info of infos) sessions.set(info.id, new LanguageServerSession(info, environment));
  monaco.editor.getModels().forEach(track);
  monaco.editor.onDidCreateModel(track);
  // Clicking into an editor brings back a server that was stopped for being idle.
  const wakeOnFocus = (editor: monaco.editor.ICodeEditor) =>
    editor.onDidFocusEditorText(() => {
      const model = editor.getModel();
      if (model) sessionFor(model)?.wake();
    });
  monaco.editor.getEditors().forEach(wakeOnFocus);
  monaco.editor.onDidCreateEditor(wakeOnFocus);
  // A failed server may work after any settings change (its command, the compiler, the interpreter…).
  useSettings.subscribe((s, prev) => {
    if (s.values !== prev.values) for (const session of sessions.values()) session.retryIfFailed();
  });
}

export const languageServersApi: LanguageServersApi = {
  list: () => useLanguageServers.getState().infos,
  useStates: () => useLanguageServers((s) => s.states),
  restart(id) {
    for (const session of sessions.values()) if (!id || session.id === id) session.restart();
  },
  async format(path) {
    const model = monaco.editor.getModel(monaco.Uri.parse(fileModelPath(path)));
    const session = model && sessionFor(model);
    return session ? session.format(model, { tabSize: getSetting("editor.tabSize"), insertSpaces: true }) : null;
  },
};
