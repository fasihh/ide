import type * as lsp from "vscode-languageserver-protocol";
import { monaco } from "../monaco.ts";

/** LSP positions are 0-based (UTF-16, like JS strings); Monaco's are 1-based. */
export const toLspPosition = (p: monaco.IPosition): lsp.Position => ({ line: p.lineNumber - 1, character: p.column - 1 });

export const toMonacoRange = (r: lsp.Range): monaco.IRange => ({
  startLineNumber: r.start.line + 1,
  startColumn: r.start.character + 1,
  endLineNumber: r.end.line + 1,
  endColumn: r.end.character + 1,
});

/** Canonical form of a document URI, so server-sent URIs match model URIs (drive-letter case, `%3A`). */
export const canonicalUri = (uri: string) => monaco.Uri.parse(uri).toString();

const SEVERITY: Record<lsp.DiagnosticSeverity, monaco.MarkerSeverity> = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
};

export function toMarker(d: lsp.Diagnostic): monaco.editor.IMarkerData {
  return {
    ...toMonacoRange(d.range),
    severity: SEVERITY[d.severity ?? 1],
    message: typeof d.message === "string" ? d.message : d.message.value,
    source: d.source,
    code: d.code === undefined ? undefined : String(d.code),
  };
}

/** LSP `CompletionItemKind` (1-based, see the spec) → Monaco's enum, matched by name. */
const KIND_NAMES = [
  "Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface", "Module", "Property", "Unit", "Value", "Enum",
  "Keyword", "Snippet", "Color", "File", "Reference", "Folder", "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter",
] as const;

export function toCompletionKind(kind: lsp.CompletionItemKind | undefined): monaco.languages.CompletionItemKind {
  const name = kind ? KIND_NAMES[kind - 1] : undefined;
  return name ? monaco.languages.CompletionItemKind[name] : monaco.languages.CompletionItemKind.Text;
}

export function toMarkdown(content: lsp.MarkupContent | lsp.MarkedString | string): monaco.IMarkdownString {
  if (typeof content === "string") return { value: content };
  if ("kind" in content) return { value: content.kind === "markdown" ? content.value : escapeMarkdown(content.value) };
  return { value: "```" + content.language + "\n" + content.value + "\n```" };
}

export function hoverContents(contents: lsp.Hover["contents"]): monaco.IMarkdownString[] {
  return (Array.isArray(contents) ? contents : [contents]).map(toMarkdown).filter((m) => m.value.trim() !== "");
}

const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");

export const toTextEdit = (e: lsp.TextEdit): monaco.languages.TextEdit => ({ range: toMonacoRange(e.range), text: e.newText });

/** A completion item, remembering the LSP item so `completionItem/resolve` can fill in details. */
export type LspCompletionItem = monaco.languages.CompletionItem & { lspItem: lsp.CompletionItem };

export function toCompletionItem(item: lsp.CompletionItem, defaultRange: monaco.IRange): LspCompletionItem {
  const edit = item.textEdit;
  const range = !edit ? defaultRange : "range" in edit ? toMonacoRange(edit.range) : { insert: toMonacoRange(edit.insert), replace: toMonacoRange(edit.replace) };
  return {
    lspItem: item,
    label: item.labelDetails ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description } : item.label,
    kind: toCompletionKind(item.kind),
    detail: item.detail,
    documentation: item.documentation === undefined ? undefined : toMarkdown(item.documentation),
    insertText: edit?.newText ?? item.insertText ?? item.label,
    insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range,
    filterText: item.filterText,
    sortText: item.sortText,
    preselect: item.preselect,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map(toTextEdit),
  };
}

export function toLocations(result: lsp.Location | lsp.Location[] | lsp.LocationLink[] | null): monaco.languages.Location[] {
  if (!result) return [];
  return (Array.isArray(result) ? result : [result]).map((l) =>
    "targetUri" in l
      ? { uri: monaco.Uri.parse(l.targetUri), range: toMonacoRange(l.targetSelectionRange) }
      : { uri: monaco.Uri.parse(l.uri), range: toMonacoRange(l.range) },
  );
}

export const toLspRange = (r: monaco.IRange): lsp.Range => ({
  start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
  end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
});

/** The text edits a `WorkspaceEdit` makes to one document (`changes` or `documentChanges` form). */
export function editsForDocument(edit: lsp.WorkspaceEdit, uri: string): lsp.TextEdit[] {
  const target = canonicalUri(uri);
  const fromChanges = Object.entries(edit.changes ?? {}).flatMap(([u, edits]) => (canonicalUri(u) === target ? edits : []));
  const fromDocumentChanges = (edit.documentChanges ?? []).flatMap((change) =>
    "textDocument" in change && canonicalUri(change.textDocument.uri) === target ? change.edits.filter((e): e is lsp.TextEdit => "range" in e) : [],
  );
  return [...fromChanges, ...fromDocumentChanges];
}

/** Documents other than `uri` that a `WorkspaceEdit` would change. */
export function otherDocuments(edit: lsp.WorkspaceEdit, uri: string): string[] {
  const target = canonicalUri(uri);
  const uris = [...Object.keys(edit.changes ?? {}), ...(edit.documentChanges ?? []).map((c) => ("textDocument" in c ? c.textDocument.uri : "uri" in c ? c.uri : c.oldUri))];
  return [...new Set(uris.map(canonicalUri))].filter((u) => u !== target);
}

const INLAY_KIND: Record<lsp.InlayHintKind, monaco.languages.InlayHintKind> = {
  1: monaco.languages.InlayHintKind.Type,
  2: monaco.languages.InlayHintKind.Parameter,
};

export function toInlayHint(hint: lsp.InlayHint): monaco.languages.InlayHint {
  const tooltip = (t: string | lsp.MarkupContent | undefined) => (t === undefined ? undefined : typeof t === "string" ? t : toMarkdown(t));
  return {
    position: { lineNumber: hint.position.line + 1, column: hint.position.character + 1 },
    label: typeof hint.label === "string" ? hint.label : hint.label.map((part) => ({ label: part.value, tooltip: tooltip(part.tooltip) })),
    kind: hint.kind ? INLAY_KIND[hint.kind] : undefined,
    tooltip: tooltip(hint.tooltip),
    paddingLeft: hint.paddingLeft,
    paddingRight: hint.paddingRight,
  };
}
