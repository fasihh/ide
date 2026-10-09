import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import { activeEditor, reindentModel, setIndentation, useActiveIndentation } from "@cp-ide/editor";
import { Tooltip } from "@cp-ide/ui";

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Pick how the current file is indented. "Indent using …" only changes what new indentation looks like;
 * "Re-indent …" also rewrites the lines already there (e.g. 4 spaces → 2 spaces per level).
 */
export async function changeIndentation(ctx: WebPluginContext) {
  const editor = activeEditor();
  const model = editor?.getModel();
  if (!editor || !model) return ctx.notify.info("Click into a code editor first");
  const { tabSize, insertSpaces } = model.getOptions();
  const current = insertSpaces ? `${tabSize} spaces` : `tabs (width ${tabSize})`;
  const action = await ctx.ui.quickPick(
    [
      { label: "Indent using spaces…", description: "For new lines; existing lines stay as they are", value: "spaces" as const },
      { label: "Indent using tabs…", description: "For new lines; existing lines stay as they are", value: "tabs" as const },
      { label: "Re-indent file with spaces…", description: `Rewrite every line's indentation (now ${current})`, value: "reindent-spaces" as const },
      { label: "Re-indent file with tabs…", description: `Rewrite every line's indentation (now ${current})`, value: "reindent-tabs" as const },
      { label: "Detect from content", description: "Guess from how this file is already indented", value: "detect" as const },
    ],
    { title: `Indentation of this file — now ${current}`, placeholder: "Only this file changes; Settings → Editor sets the default" },
  );
  if (!action) return;
  if (action === "detect") return model.detectIndentation(insertSpaces, tabSize);
  const spaces = action === "spaces" || action === "reindent-spaces";
  const size = await ctx.ui.quickPick(
    SIZES.map((n) => ({ label: String(n), description: n === tabSize ? "current" : undefined, value: n })).sort((a, b) => Number(b.value === tabSize) - Number(a.value === tabSize)),
    { title: spaces ? "Spaces per indentation level" : "Tab width" },
  );
  if (size === undefined) return;
  const style = { tabSize: size, insertSpaces: spaces };
  if (action.startsWith("reindent")) reindentModel(model, style);
  else setIndentation(model, style);
}

/** "Spaces: 4" / "Tabs: 4" for the file in the last focused editor; click to change it. */
export function IndentationStatus({ ctx }: PanelProps) {
  const indentation = useActiveIndentation();
  if (!indentation) return null;
  return (
    <Tooltip content="Indentation of this file — click to change">
      <button className="cursor-pointer hover:text-foreground" onClick={() => ctx.commands.execute("editor.changeIndentation")}>
        {indentation.insertSpaces ? "Spaces" : "Tabs"}: {indentation.tabSize}
      </button>
    </Tooltip>
  );
}
