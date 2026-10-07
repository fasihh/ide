import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import { fuzzyMatch } from "@cp-ide/shared";
import { Kbd, cn } from "@cp-ide/ui";
import { closePalette, openPalette, resolveMode, usePalette } from "./store.ts";
import type { PaletteControl, PaletteItem, PaletteProvider } from "./types.ts";

type Row = { item: PaletteItem; indices: number[]; score: number };
type Section = { provider: PaletteProvider; rows: Row[] };

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {[...text].map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-primary">
            {ch}
          </span>
        ) : (
          ch
        ),
      )}
    </>
  );
}

function rank(items: PaletteItem[], text: string, provider: PaletteProvider, limit: number): Row[] {
  if (provider.filter === false || !text) return items.slice(0, limit).map((item) => ({ item, indices: [], score: 0 }));
  const rows: Row[] = [];
  for (const item of items) {
    const m = fuzzyMatch(text, item.label);
    if (m) {
      rows.push({ item, indices: m.indices, score: m.score + 3 });
      continue;
    }
    const extra = fuzzyMatch(text, `${item.description ?? ""} ${item.keywords ?? ""}`);
    if (extra) rows.push({ item, indices: [], score: extra.score });
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Collect results from every provider of the current mode (async-safe: stale results are dropped). */
function useSections(query: string, providers: PaletteProvider[]) {
  const [sections, setSections] = useState<Section[]>([]);
  const { prefix, active, text } = useMemo(() => resolveMode(query, providers), [query, providers]);
  useEffect(() => {
    let stale = false;
    const defaultEmpty = prefix === "" && !text;
    Promise.all(
      active.map(async (provider) => {
        try {
          const items = await provider.provide(text);
          return { provider, rows: rank(items, text, provider, provider.limit ?? (defaultEmpty ? 8 : 50)) };
        } catch (err) {
          console.error(`[palette] provider ${provider.id} failed`, err);
          return { provider, rows: [] };
        }
      }),
    ).then((res) => {
      if (!stale) setSections(res.filter((s) => s.rows.length));
    });
    return () => {
      stale = true;
    };
  }, [active, text, prefix]);
  return { sections, prefix, active };
}

export function Palette(_: PanelProps) {
  const open = usePalette((s) => s.open);
  if (!open) return null;
  return <PaletteDialog />;
}

function PaletteDialog() {
  const query = usePalette((s) => s.query);
  const providers = usePalette((s) => s.providers);
  const { sections, prefix, active } = useSections(query, providers);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const modes = useMemo(() => providers.filter((p) => p.prefix).sort((a, b) => a.prefix.localeCompare(b.prefix)), [providers]);

  useEffect(() => setSelected(0), [sections]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useEffect(() => inputRef.current?.focus(), [prefix]);

  const control: PaletteControl = {
    setQuery: (q) => {
      openPalette(q);
      inputRef.current?.focus();
    },
    close: closePalette,
  };

  const run = (row: Row | undefined) => {
    if (!row) return;
    if (!row.item.keepOpen) closePalette();
    Promise.resolve()
      .then(() => row.item.run(control))
      .catch((err) => console.error("[palette] item failed", err));
  };

  const placeholder = prefix ? (active[0]?.placeholder ?? active[0]?.title) : "Search problems and files — type > for commands, # for panels, ? for help";
  let index = -1;

  return (
    <div className="fixed inset-0 z-50" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div className="absolute top-12 left-1/2 w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            spellCheck={false}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder={placeholder}
            value={query}
            onChange={(e) => openPalette(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closePalette();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (flat.length) setSelected((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(flat[selected]);
              } else if (e.key === "Backspace" && prefix && query === prefix) {
                e.preventDefault();
                openPalette("");
              }
            }}
          />
          {prefix && <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[0.625rem] font-medium text-accent-foreground">{active[0]?.title}</span>}
        </div>

        <div ref={listRef} className="max-h-[min(60vh,28rem)] overflow-y-auto p-1">
          {sections.map((section) => (
            <div key={section.provider.id}>
              {(sections.length > 1 || !prefix) && (
                <div className="px-2 pt-1.5 pb-0.5 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">{section.provider.title}</div>
              )}
              {section.rows.map((row) => {
                index++;
                const i = index;
                const Icon = row.item.icon;
                return (
                  <div
                    key={row.item.id}
                    data-index={i}
                    onMouseMove={() => setSelected(i)}
                    onClick={() => run(row)}
                    className={cn(
                      "flex cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 text-xs select-none",
                      i === selected && "bg-accent text-accent-foreground",
                    )}
                  >
                    {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">
                        <Highlight text={row.item.label} indices={row.indices} />
                        {row.item.description && <span className="ml-2 text-muted-foreground">{row.item.description}</span>}
                      </div>
                      {row.item.detail && <div className="truncate text-[0.6875rem] text-muted-foreground">{row.item.detail}</div>}
                    </div>
                    {row.item.hint && <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">{row.item.hint}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {sections.length === 0 && <div className="px-2 py-4 text-center text-xs text-muted-foreground">No matches</div>}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-[0.625rem] text-muted-foreground">
          {modes.map((m) => (
            <button
              key={m.id}
              className={cn("flex cursor-pointer items-center gap-1 hover:text-foreground", prefix === m.prefix && "text-foreground")}
              onClick={() => control.setQuery(prefix === m.prefix ? "" : m.prefix)}
            >
              <Kbd className="h-3.5 px-1 text-[0.5625rem]">{m.prefix}</Kbd>
              {m.title}
            </button>
          ))}
          <span className="ml-auto">↑↓ navigate · Enter select · Esc close</span>
        </div>
      </div>
    </div>
  );
}
