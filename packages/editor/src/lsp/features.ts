import type { LanguageClient } from "@cp-ide/lsp-client";
import type * as lsp from "vscode-languageserver-protocol";
import { monaco } from "../monaco.ts";
import { type LspCompletionItem, hoverContents, toCompletionItem, toLocations, toLspPosition, toMarkdown, toMonacoRange } from "./convert.ts";

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

  const disposables: monaco.IDisposable[] = [];
  for (const language of languages) {
    if (caps.completionProvider) {
      disposables.push(
        monaco.languages.registerCompletionItemProvider(language, {
          triggerCharacters: caps.completionProvider.triggerCharacters,
          async provideCompletionItems(model, position, context, token) {
            if (!owns(model)) return undefined;
            const result = await ask<lsp.CompletionList | lsp.CompletionItem[]>(
              "textDocument/completion",
              { ...doc(model, position), context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter } },
              token,
            );
            if (!result) return undefined;
            const word = model.getWordUntilPosition(position);
            const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
            const items = Array.isArray(result) ? result : result.items;
            return { suggestions: items.map((item) => toCompletionItem(item, range)), incomplete: !Array.isArray(result) && result.isIncomplete };
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
  }
  return { dispose: () => disposables.forEach((d) => d.dispose()) };
}

/** Only locations in files the editor has open can be shown (e.g. not inside system headers). */
const openLocations = (locations: monaco.languages.Location[]) => locations.filter((l) => monaco.editor.getModel(l.uri));

function signalOf(token: monaco.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  else token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}
