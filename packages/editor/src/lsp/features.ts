import { SwrCache } from "@cp-ide/cache";
import { type CompletionResult, type LanguageClient, memberCompletionKeys, rebaseCompletion, withoutEditRanges } from "@cp-ide/lsp-client";
import type * as lsp from "vscode-languageserver-protocol";
import { monaco } from "../monaco.ts";
import {
  type LspCompletionItem,
  editsForDocument,
  hoverContents,
  otherDocuments,
  toCompletionItem,
  toInlayHint,
  toLocations,
  toLspPosition,
  toLspRange,
  toMarkdown,
  toMonacoRange,
  toTextEdit,
} from "./convert.ts";

/**
 * Monaco providers backed by a language client. They answer only for models the client has open, so
 * several servers (or none) can share a language id; Monaco merges their results with other providers
 * such as snippets.
 */
export function registerLanguageFeatures(client: LanguageClient, languages: string[]): monaco.IDisposable {
  const caps = client.capabilities;
  const owns = (model: monaco.editor.ITextModel) => client.isOpen(model.uri.toString());
  const doc = (model: monaco.editor.ITextModel, position: monaco.IPosition) => ({
    textDocument: { uri: model.uri.toString() },
    position: toLspPosition(position),
  });
  const ask = async <R>(method: string, params: unknown, token: monaco.CancellationToken): Promise<R | null> => {
    try {
      return await client.request<R>(method, params, signalOf(token));
    } catch {
      return null; // cancelled, or the server went away
    }
  };

  // Member completions (`np.`, `v.`, `std::`) are slow to compute on big libraries but rarely change:
  // repeats are served from here at once while the server refreshes them in the background.
  const completions = new SwrCache<{ result: CompletionResult; at: lsp.Position }>({
    maxEntries: 300,
    shouldCache: ({ result }) => (Array.isArray(result) ? result : result.items).length > 0,
  });

  const disposables: monaco.IDisposable[] = [{ dispose: () => completions.clear() }];
  for (const language of languages) {
    if (caps.completionProvider) {
      disposables.push(
        monaco.languages.registerCompletionItemProvider(language, {
          triggerCharacters: caps.completionProvider.triggerCharacters,
          async provideCompletionItems(model, position, context, token) {
            if (!owns(model)) return undefined;
            const params = { ...doc(model, position), context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter } };
            const linePrefix = model.getValueInRange({ ...lineStart(position), endLineNumber: position.lineNumber, endColumn: position.column });
            const keys = memberCompletionKeys(params.textDocument.uri, linePrefix);
            let result: CompletionResult | null = null;
            let superset = false;
            if (keys) {
              const [exact, ...shorter] = keys as [string, ...string[]];
              // Not tied to Monaco's token: a finished load is stored even if the user typed on.
              const load = () => client.request<CompletionResult>("textDocument/completion", params).then((r) => ({ result: r, at: params.position }));
              const fallback = completions.peek(exact) ? undefined : shorter.map((k) => completions.peek(k)).find(Boolean);
              if (fallback) {
                // e.g. `np.z` for the first time: show the cached `np.` list now, load the exact one.
                completions.get(exact, load).catch(() => {});
                result = withoutEditRanges(fallback.result);
                superset = true;
              } else {
                const cached = await completions.get(exact, load).catch(() => null);
                result = cached && rebaseCompletion(cached.result, cached.at, params.position);
              }
            } else {
              result = await ask<CompletionResult>("textDocument/completion", params, token);
            }
            if (!result) return undefined;
            const word = model.getWordUntilPosition(position);
            const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
            const items = Array.isArray(result) ? result : result.items;
            // A superset is incomplete by definition: Monaco asks again on the next keystroke and gets the exact list once loaded.
            return { suggestions: items.map((item) => toCompletionItem(item, range)), incomplete: superset || (!Array.isArray(result) && result.isIncomplete) };
          },
          resolveCompletionItem: caps.completionProvider.resolveProvider
            ? async (item, token) => {
                const resolved = await ask<lsp.CompletionItem>("completionItem/resolve", (item as LspCompletionItem).lspItem, token);
                if (!resolved) return item;
                return {
                  ...item,
                  detail: resolved.detail ?? item.detail,
                  documentation: resolved.documentation === undefined ? item.documentation : toMarkdown(resolved.documentation),
                };
              }
            : undefined,
        }),
      );
    }
    if (caps.hoverProvider) {
      disposables.push(
        monaco.languages.registerHoverProvider(language, {
          async provideHover(model, position, token) {
            if (!owns(model)) return undefined;
            const hover = await ask<lsp.Hover>("textDocument/hover", doc(model, position), token);
            if (!hover) return undefined;
            const contents = hoverContents(hover.contents);
            return contents.length ? { contents, range: hover.range && toMonacoRange(hover.range) } : undefined;
          },
        }),
      );
    }
    if (caps.signatureHelpProvider) {
      disposables.push(
        monaco.languages.registerSignatureHelpProvider(language, {
          signatureHelpTriggerCharacters: caps.signatureHelpProvider.triggerCharacters,
          signatureHelpRetriggerCharacters: caps.signatureHelpProvider.retriggerCharacters,
          async provideSignatureHelp(model, position, token, context) {
            if (!owns(model)) return undefined;
            const help = await ask<lsp.SignatureHelp>(
              "textDocument/signatureHelp",
              { ...doc(model, position), context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger } },
              token,
            );
            if (!help?.signatures.length) return undefined;
            return {
              value: {
                activeSignature: help.activeSignature ?? 0,
                activeParameter: help.activeParameter ?? 0,
                signatures: help.signatures.map((s) => ({
                  label: s.label,
                  documentation: s.documentation === undefined ? undefined : toMarkdown(s.documentation),
                  activeParameter: s.activeParameter ?? undefined,
                  parameters: (s.parameters ?? []).map((p) => ({ label: p.label, documentation: p.documentation === undefined ? undefined : toMarkdown(p.documentation) })),
                })),
              },
              dispose() {},
            };
          },
        }),
      );
    }
    if (caps.definitionProvider) {
      disposables.push(
        monaco.languages.registerDefinitionProvider(language, {
          async provideDefinition(model, position, token) {
            if (!owns(model)) return undefined;
            return openLocations(toLocations(await ask("textDocument/definition", doc(model, position), token)));
          },
        }),
      );
    }
    if (caps.referencesProvider) {
      disposables.push(
        monaco.languages.registerReferenceProvider(language, {
          async provideReferences(model, position, context, token) {
            if (!owns(model)) return undefined;
            const params = { ...doc(model, position), context: { includeDeclaration: context.includeDeclaration } };
            return openLocations(toLocations(await ask("textDocument/references", params, token)));
          },
        }),
      );
    }
    if (caps.renameProvider) {
      const prepare = typeof caps.renameProvider === "object" && caps.renameProvider.prepareProvider;
      disposables.push(
        monaco.languages.registerRenameProvider(language, {
          async provideRenameEdits(model, position, newName, token) {
            if (!owns(model)) return undefined;
            const uri = model.uri.toString();
            const edit = await ask<lsp.WorkspaceEdit>("textDocument/rename", { ...doc(model, position), newName }, token);
            if (!edit) return { edits: [], rejectReason: "The language server could not rename this symbol" };
            // Other files' editors keep their own buffers, so a partial rename would desynchronise them.
            const others = otherDocuments(edit, uri);
            if (others.length) return { edits: [], rejectReason: `Renaming across files is not supported yet (also used in ${others.map(fileName).join(", ")})` };
            return { edits: editsForDocument(edit, uri).map((e) => ({ resource: model.uri, textEdit: toTextEdit(e), versionId: undefined })) };
          },
          resolveRenameLocation: prepare
            ? async (model, position, token) => {
                const word = model.getWordAtPosition(position);
                const wordRange = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word?.startColumn ?? position.column, endColumn: word?.endColumn ?? position.column };
                const res = await ask<lsp.PrepareRenameResult>("textDocument/prepareRename", doc(model, position), token);
                if (!res) return { range: wordRange, text: "", rejectReason: "This symbol cannot be renamed" };
                if ("defaultBehavior" in res) return { range: wordRange, text: word?.word ?? "" };
                const range = toMonacoRange("range" in res ? res.range : res);
                return { range, text: "placeholder" in res ? res.placeholder : model.getValueInRange(range) };
              }
            : undefined,
        }),
      );
    }
    if (caps.inlayHintProvider) {
      const changed = new monaco.Emitter<void>();
      // Servers ask for a refresh when hints elsewhere change (e.g. after an edit in another file), and
      // published diagnostics mean a fresh analysis — hints asked for before it may have been empty.
      disposables.push(
        changed,
        client.connection.onRequest("workspace/inlayHint/refresh", () => changed.fire()),
        client.onDiagnostics(() => changed.fire()),
      );
      disposables.push(
        monaco.languages.registerInlayHintsProvider(language, {
          onDidChangeInlayHints: changed.event,
          async provideInlayHints(model, range, token) {
            if (!owns(model)) return undefined;
            const hints = await ask<lsp.InlayHint[]>("textDocument/inlayHint", { textDocument: { uri: model.uri.toString() }, range: toLspRange(range) }, token);
            return { hints: (hints ?? []).map(toInlayHint), dispose() {} };
          },
        }),
      );
    }
  }
  return { dispose: () => disposables.forEach((d) => d.dispose()) };
}

const fileName = (uri: string) => decodeURIComponent(uri.split("/").pop() ?? uri);

const lineStart = (position: monaco.IPosition) => ({ startLineNumber: position.lineNumber, startColumn: 1 });

/** Only locations in files the editor has open can be shown (e.g. not inside system headers). */
const openLocations = (locations: monaco.languages.Location[]) => locations.filter((l) => monaco.editor.getModel(l.uri));

function signalOf(token: monaco.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  else token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}
