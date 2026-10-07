import { Puzzle } from "lucide-react";
import type { Disposable, WebPluginContext } from "@cp-ide/plugin-api/web";
import type { PaletteService } from "@cp-ide/plugin-palette";
import { type LibraryItem, parseSnippet, snippetPreview } from "@cp-ide/shared";
import { monaco } from "../editor/monaco.ts";
import { currentEditor } from "../editor/EditorPanel.tsx";

const CACHE_MS = 5000;
let cache: { at: number; items: LibraryItem[] } | null = null;

type Snippet = { name: string; language: LibraryItem["language"]; prefix: string; description?: string; body: string };

async function snippets(ctx: WebPluginContext, fresh = false): Promise<Snippet[]> {
  if (fresh || !cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), items: await ctx.library.list("snippets") };
  return cache.items.map((item) => {
    const parsed = parseSnippet(item.content);
    return {
      name: item.name,
      language: item.language,
      prefix: parsed.prefix ?? item.name.replace(/\.(cpp|py)$/, ""),
      description: parsed.description,
      body: parsed.body,
    };
  });
}

const languageOfModel = (model: monaco.editor.ITextModel) => (model.getLanguageId() === "python" ? "python" : "cpp");

/** One-line summary: the description, else the first meaningful line of code. */
const summary = (s: Snippet) => s.description ?? snippetPreview(s.body).split("\n").find((l) => l.trim())?.trim() ?? "";

/**
 * Insert at the cursor as a Monaco snippet: placeholders become Tab stops and indentation follows
 * the current line. Plain text (no snippet syntax) works the same way.
 */
export function insertSnippet(body: string) {
  const editor = currentEditor();
  if (!editor?.getModel()) return false;
  editor.focus();
  const controller = editor.getContribution("snippetController2") as { insert(template: string): void } | null;
  if (controller) controller.insert(body);
  else editor.trigger("snippet", "type", { text: snippetPreview(body) });
  return true;
}

/** Plain text at the cursor (escapes `$` so it is not read as snippet syntax). */
export function insertText(text: string) {
  return insertSnippet(text.replace(/\$/g, "\\$"));
}

/** Quick pick → insert at the cursor of the code editor. */
export async function pickSnippet(ctx: WebPluginContext) {
  const model = currentEditor()?.getModel();
  if (!model) return ctx.notify.info("Open a file in the code editor first");
  const lang = languageOfModel(model);
  const items = (await snippets(ctx, true)).filter((s) => s.language === lang);
  if (!items.length) return ctx.notify.info("No snippets for this language", "Add some in Templates & Snippets.");
  const item = await ctx.ui.quickPick(
    items.map((s) => ({ label: s.prefix, description: summary(s), hint: s.name, value: s })),
    { placeholder: "Insert snippet" },
  );
  if (item) insertSnippet(item.body);
}

/** Suggest snippets by prefix while typing in C++ / Python editors. */
export function registerSnippetCompletions(ctx: WebPluginContext): Disposable {
  const providers = (["cpp", "python"] as const).map((language) =>
    monaco.languages.registerCompletionItemProvider(language, {
      async provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const items = (await snippets(ctx)).filter((s) => s.language === language);
        return {
          suggestions: items.map((s) => ({
            label: { label: s.prefix, description: s.description ?? s.name },
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `snippet · ${s.name}`,
            documentation: { value: `${s.description ? `${s.description}\n\n` : ""}\`\`\`${language}\n${snippetPreview(s.body)}\n\`\`\`` },
            insertText: s.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      },
    }),
  );
  return { dispose: () => providers.forEach((p) => p.dispose()) };
}

/** "@" in the palette: snippets for the language of the active file. */
export function registerSnippetPaletteMode(ctx: WebPluginContext) {
  ctx.services.whenAvailable<PaletteService>("palette", (palette) => {
    ctx.commands.register({ id: "snippets.palette", title: "Browse snippets…", category: "Editor", run: () => palette.open("@") });
    palette.registerProvider({
      id: "snippets",
      prefix: "@",
      title: "Snippets",
      placeholder: "Insert a snippet at the cursor",
      provide: async () => {
        const model = currentEditor()?.getModel();
        const lang = model ? languageOfModel(model) : undefined;
        return (await snippets(ctx, true))
          .filter((s) => !lang || s.language === lang)
          .map((s) => ({
            id: `snippet:${s.name}`,
            label: s.prefix,
            description: summary(s),
            hint: s.name,
            keywords: s.name,
            icon: Puzzle,
            run: () => {
              ctx.panels.open("core.editor");
              if (!insertSnippet(s.body)) ctx.notify.info("Open a file in the code editor first");
            },
          }));
      },
    });
  });
}
