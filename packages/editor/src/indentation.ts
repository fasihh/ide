import { useSyncExternalStore } from "react";
import { reindent } from "@cp-ide/shared";
import { activeEditor, monaco, onDidChangeActiveEditor } from "./monaco.ts";

export type Indentation = { tabSize: number; insertSpaces: boolean };
export type IndentationDefaults = { tabSize: number; detect: boolean };

/**
 * Indentation lives on each file (Monaco model). A file gets the defaults the first time an editor shows
 * it; after that, a per-file choice (status bar) sticks until the settings change, which re-applies the
 * defaults to every file.
 */
const configured = new WeakSet<monaco.editor.ITextModel>();

function applyDefaults(model: monaco.editor.ITextModel, { tabSize, detect }: IndentationDefaults) {
  if (detect) model.detectIndentation(true, tabSize);
  else model.updateOptions({ tabSize, indentSize: tabSize, insertSpaces: true });
}

/** Give a file the default indentation unless it already has one. */
export function ensureIndentation(model: monaco.editor.ITextModel, defaults: IndentationDefaults) {
  if (configured.has(model)) return;
  configured.add(model);
  applyDefaults(model, defaults);
}

/** The settings changed: every file goes back to the defaults. */
export function reapplyIndentation(defaults: IndentationDefaults) {
  for (const model of monaco.editor.getModels()) if (configured.has(model)) applyDefaults(model, defaults);
}

/** Set one file's indentation (the per-file override). */
export function setIndentation(model: monaco.editor.ITextModel, { tabSize, insertSpaces }: Indentation) {
  model.updateOptions({ tabSize, indentSize: tabSize, insertSpaces });
}

let snapshot: Indentation | null = null;

function readActive(): Indentation | null {
  const options = activeEditor()?.getModel()?.getOptions();
  const next = options ? { tabSize: options.tabSize, insertSpaces: options.insertSpaces } : null;
  // Keep the same object while nothing changed, as useSyncExternalStore requires.
  if (next?.tabSize !== snapshot?.tabSize || next?.insertSpaces !== snapshot?.insertSpaces) snapshot = next;
  return snapshot;
}

const subscribe = (cb: () => void) => {
  const sub = onDidChangeActiveEditor(cb);
  return () => sub.dispose();
};

/** React hook: the indentation of the file in the last focused editor, or null. */
export function useActiveIndentation(): Indentation | null {
  return useSyncExternalStore(subscribe, readActive);
}

/** Rewrite the file's existing indentation in a new style (one undoable edit), and indent with it from now on. */
export function reindentModel(model: monaco.editor.ITextModel, to: Indentation) {
  const { tabSize, insertSpaces } = model.getOptions();
  const text = model.getValue();
  const next = reindent(text, { tabSize, insertSpaces }, to);
  if (next !== text) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: next }], () => null);
  setIndentation(model, to);
}
