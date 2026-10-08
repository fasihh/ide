import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import { type LibraryItem, type LibraryKind, libraryNameSchema } from "@cp-ide/shared";
import { Button, Tooltip, cn } from "@cp-ide/ui";
import { CodeEditor } from "@cp-ide/editor";

const SAVE_DELAY = 600;

const KIND_INFO: Record<LibraryKind, { title: string; hint: string; suggestion: string }> = {
  templates: {
    title: "Templates",
    hint: "New problems and new .cpp/.py files start from a template. ★ marks the default per language.",
    suggestion: "interactive.cpp",
  },
  snippets: {
    title: "Snippets",
    hint: "Insert with Ctrl+Alt+I, @ in the palette, or by typing the name in the editor. Optional first lines: // @description …, // @prefix …. Use ${1:name} placeholders (Tab jumps), $0 for the final cursor.",
    suggestion: "segtree.cpp",
  },
};

const validate = (items: LibraryItem[], v: string, except?: string) => {
  const res = libraryNameSchema.safeParse(v);
  if (!res.success) return res.error.issues[0]?.message;
  if (v !== except && items.some((i) => i.name === v)) return "Name already used";
  return undefined;
};

async function createItem(ctx: WebPluginContext, kind: LibraryKind, items: LibraryItem[]) {
  const name = await ctx.ui.prompt({ title: `New ${kind === "templates" ? "template" : "snippet"}`, value: KIND_INFO[kind].suggestion, validate: (v) => validate(items, v) });
  if (!name) return null;
  await ctx.library.create(kind, name, kind === "templates" ? "" : `// ${name}\n`);
  return name;
}

export function LibraryPanel({ ctx }: PanelProps) {
  const [kind, setKind] = useState<LibraryKind>("templates");
  const items = ctx.library.use(kind);
  const [selected, setSelected] = useState<Record<LibraryKind, string | null>>({ templates: null, snippets: null });
  const [draft, setDraft] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const defaultCpp = ctx.settings.use("templates.defaultCpp");
  const defaultPy = ctx.settings.use("templates.defaultPython");

  const current = items?.find((i) => i.name === selected[kind]) ?? items?.[0] ?? null;
  const isDefault = (i: LibraryItem) => kind === "templates" && (i.language === "cpp" ? defaultCpp : defaultPy) === i.name;

  // Flush a pending save when switching items/kinds or unmounting.
  const pending = useRef<{ kind: LibraryKind; name: string; content: string } | null>(null);
  const flush = () => {
    clearTimeout(saveTimer.current);
    const p = pending.current;
    pending.current = null;
    if (p) void ctx.library.save(p.kind, p.name, p.content).catch((e) => ctx.notify.error("Could not save", String(e?.message ?? e)));
  };
  useEffect(() => () => flush(), []);
  useEffect(() => setDraft(null), [kind, current?.name]);

  const onChange = (content: string) => {
    if (!current) return;
    setDraft(content);
    pending.current = { kind, name: current.name, content };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY);
  };

  async function rename(i: LibraryItem) {
    const to = await ctx.ui.prompt({ title: `Rename ${i.name}`, value: i.name, validate: (v) => validate(items ?? [], v, i.name) });
    if (!to || to === i.name) return;
    flush();
    await ctx.library.rename(kind, i.name, to).catch((e) => ctx.notify.error("Could not rename", String(e?.message ?? e)));
    if (isDefault(i)) await ctx.settings.set(i.language === "cpp" ? "templates.defaultCpp" : "templates.defaultPython", to);
    setSelected((s) => ({ ...s, [kind]: to }));
  }

  async function remove(i: LibraryItem) {
    if (isDefault(i)) return ctx.notify.error("This is the default template", "Make another template the default first.");
    const ok = await ctx.ui.confirm({ title: `Delete ${i.name}?`, confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    pending.current = null;
    await ctx.library.remove(kind, i.name).catch((e) => ctx.notify.error("Could not delete", String(e?.message ?? e)));
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[min(14rem,40%)] shrink-0 flex-col border-r">
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b px-2">
          {(["templates", "snippets"] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                flush();
                setKind(k);
              }}
              className={cn(
                "h-6 cursor-pointer rounded px-2 text-xs",
                kind === k ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {KIND_INFO[k].title}
            </button>
          ))}
          <div className="flex-1" />
          <Tooltip content="New">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={async () => {
                flush();
                const name = await createItem(ctx, kind, items ?? []);
                if (name) setSelected((s) => ({ ...s, [kind]: name }));
              }}
            >
              <Plus />
            </Button>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {items?.map((i) => (
            <div
              key={i.name}
              onClick={() => {
                flush();
                setSelected((s) => ({ ...s, [kind]: i.name }));
              }}
              onDoubleClick={() => rename(i)}
              className={cn(
                "group flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2 font-mono text-[0.6875rem] select-none hover:bg-accent",
                current?.name === i.name && "bg-accent text-accent-foreground",
              )}
            >
              <span className="truncate">{i.name}</span>
              {isDefault(i) && <Star className="size-3 shrink-0 fill-verdict-tle text-verdict-tle" />}
              <div className="ml-auto hidden items-center group-hover:flex">
                {kind === "templates" && !isDefault(i) && (
                  <Tooltip content={`Make default for ${i.language === "cpp" ? "C++" : "Python"}`}>
                    <button
                      className="flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        void ctx.settings.set(i.language === "cpp" ? "templates.defaultCpp" : "templates.defaultPython", i.name);
                      }}
                    >
                      <Star className="size-3" />
                    </button>
                  </Tooltip>
                )}
                <button
                  aria-label="Rename"
                  className="flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    void rename(i);
                  }}
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  aria-label="Delete"
                  className="flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(i);
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          ))}
          {items?.length === 0 && <div className="px-2 py-4 text-center text-xs text-muted-foreground">Nothing here yet.</div>}
        </div>
        <div className="shrink-0 border-t p-2 text-[0.625rem] leading-relaxed text-muted-foreground">{KIND_INFO[kind].hint}</div>
      </div>
      <div className="min-w-0 flex-1">
        {current ? (
          <CodeEditor
            ctx={ctx}
            // Not a file on disk (templates/snippets aren't compiled), so language servers stay out.
            path={`library:/${kind}/${current.name}`}
            language={current.language}
            value={draft ?? current.content}
            onChange={onChange}
            options={{ minimap: { enabled: false } }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{items ? "Create one with +" : "Loading…"}</div>
        )}
      </div>
    </div>
  );
}
