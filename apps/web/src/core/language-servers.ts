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

function track(model: monaco.editor.ITextModel) {
  let session = sessionFor(model);
  session?.open(model);
  const languageChange = model.onDidChangeLanguage(() => {
    session?.close(model);
    session = sessionFor(model);
    session?.open(model);
  });
  model.onWillDispose(() => {
    languageChange.dispose();
    session?.close(model);
  });
}

/** Load the registered servers and start following editor models. Call once at startup. */
export async function installLanguageServers() {
  const infos = await fetchInfos().catch(() => [] as LanguageServerInfo[]);
  useLanguageServers.setState({
    infos,
    states: Object.fromEntries(infos.map((i) => [i.id, i.available ? { phase: "idle" } : { phase: "unavailable", error: i.error, hint: i.hint, action: i.action }])),
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
