/**
 * Snippet files may start with metadata comment lines:
 *
 *   // @description Iterative segment tree        (C++)
 *   # @prefix dsu                                 (Python)
 *
 * `description` is shown in suggestions and the palette; `prefix` is the word that triggers the
 * suggestion (default: the file name without extension). The rest is the body, in Monaco snippet
 * syntax: `${1:name}` placeholders (Tab moves between them, repeated numbers edit together), `$0`
 * for the final cursor; write `\$` for a literal dollar sign.
 */
export type ParsedSnippet = { description?: string; prefix?: string; body: string };

const META = /^\s*(?:\/\/|#)\s*@(\w+)\s+(.*?)\s*$/;

export function parseSnippet(content: string): ParsedSnippet {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const out: ParsedSnippet = { body: "" };
  let i = 0;
  for (; i < lines.length; i++) {
    const m = META.exec(lines[i]!);
    if (!m) break;
    const [, key, value] = m;
    if (key === "description") out.description = value;
    else if (key === "prefix") out.prefix = value;
  }
  out.body = lines.slice(i).join("\n").replace(/\n+$/, "\n");
  return out;
}

/** The snippet body with placeholders resolved to their default text (for previews / plain insert). */
export function snippetPreview(body: string): string {
  return body
    .replace(/(?<!\\)\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/(?<!\\)(\$\{\d+\}|\$\d+)/g, "")
    .replace(/\\\$/g, "$");
}
