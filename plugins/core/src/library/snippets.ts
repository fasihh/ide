import type { Disposable, WebPluginContext } from "@cp-ide/plugin-api/web";
import type { LibraryItem } from "@cp-ide/shared";
import { monaco } from "../editor/monaco.ts";
import { currentEditor } from "../editor/EditorPanel.tsx";

const CACHE_MS = 5000;
let cache: { at: number; items: LibraryItem[] } | null = null;

async function snippets(ctx: WebPluginContext) {
  if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), items: await ctx.library.list("snippets") };
  return cache.items;
}

const languageOfModel = (model: monaco.editor.ITextModel) => (model.getLanguageId() === "python" ? "python" : "cpp");

/** Re-indent a multi-line snippet so it lines up with the cursor line. */
function indentLike(text: string, model: monaco.editor.ITextModel, line: number) {
  const indent = /^\s*/.exec(model.getLineContent(line))?.[0] ?? "";
  return text.replace(/\n$/, "").split("\n").map((l, i) => (i === 0 || !l ? l : indent + l)).join("\n");
}

export function insertText(text: string) {
  const editor = currentEditor();
  const model = editor?.getModel();
  const selection = editor?.getSelection();
  if (!editor || !model || !selection) return false;
  editor.executeEdits("snippet", [{ range: selection, text: indentLike(text, model, selection.startLineNumber), forceMoveMarkers: true }]);
  editor.pushUndoStop();
  editor.focus();
  return true;
}

/** Quick pick → insert at the cursor of the code editor. */
export async function pickSnippet(ctx: WebPluginContext) {
  const model = currentEditor()?.getModel();
  if (!model) return ctx.notify.info("Open a file in the code editor first");
  const lang = languageOfModel(model);
  cache = null;
  const items = (await snippets(ctx)).filter((s) => s.language === lang);
  if (!items.length) return ctx.notify.info("No snippets for this language", "Add some in the Library panel.");
  const item = await ctx.ui.quickPick(
    items.map((s) => ({ label: s.name.replace(/\.(cpp|py)$/, ""), description: s.name, detail: s.content.split("\n")[0], value: s })),
    { placeholder: "Insert snippet" },
  );
  if (item) insertText(item.content);
}

/** Suggest snippets by name while typing in C++ / Python editors. */
export function registerSnippetCompletions(ctx: WebPluginContext): Disposable {
  const providers = (["cpp", "python"] as const).map((language) =>
    monaco.languages.registerCompletionItemProvider(language, {
      async provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const items = (await snippets(ctx)).filter((s) => s.language === language);
        return {
          suggestions: items.map((s) => ({
            label: s.name.replace(/\.(cpp|py)$/, ""),
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `snippet · ${s.name}`,
            documentation: { value: `\`\`\`${language}\n${s.content}\n\`\`\`` },
            insertText: indentLike(s.content, model, position.lineNumber),
            range,
          })),
        };
      },
    }),
  );
  return { dispose: () => providers.forEach((p) => p.dispose()) };
}
