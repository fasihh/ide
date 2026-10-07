import { useMemo, useState } from "react";
import { Pencil, RotateCcw, Search, X } from "lucide-react";
import type { CommandInfo, PanelProps } from "@cp-ide/plugin-api/web";
import { Button, Input, Kbd, Tooltip, cn } from "@cp-ide/ui";

const norm = (b?: string) => (b ?? "").toLowerCase().replace(/\s+/g, "");

export function KeybindingsPanel({ ctx }: PanelProps) {
  const commands = ctx.commands.useList();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...commands]
      .filter((c) => !q || `${c.category ?? ""} ${c.title} ${c.id} ${c.keybinding ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => `${a.category ?? ""}${a.title}`.localeCompare(`${b.category ?? ""}${b.title}`));
  }, [commands, query]);

  const conflicts = useMemo(() => {
    const byKey = new Map<string, CommandInfo[]>();
    for (const c of commands) if (c.keybinding) byKey.set(norm(c.keybinding), [...(byKey.get(norm(c.keybinding)) ?? []), c]);
    return byKey;
  }, [commands]);

  async function record(c: CommandInfo) {
    setRecording(c.id);
    const binding = await ctx.commands.recordKeybinding();
    setRecording(null);
    if (binding) await ctx.commands.setKeybinding(c.id, binding);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-7" placeholder="Search commands or keys" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="truncate text-[0.6875rem] text-muted-foreground">Click a shortcut to change it · Esc cancels</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel text-left text-[0.6875rem] text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-1.5 font-medium">Command</th>
              <th className="px-2 py-1.5 font-medium">Shortcut</th>
              <th className="w-24 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const custom = c.keybinding !== c.defaultKeybinding;
              const clash = c.keybinding ? (conflicts.get(norm(c.keybinding)) ?? []).filter((x) => x.id !== c.id) : [];
              return (
                <tr key={c.id} className="group border-b border-border/50 hover:bg-accent/40">
                  <td className="px-4 py-1.5">
                    <div>
                      {c.category && <span className="text-muted-foreground">{c.category}: </span>}
                      {c.title}
                    </div>
                    <div className="font-mono text-[0.625rem] text-muted-foreground">{c.id}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <button className="cursor-pointer" onClick={() => record(c)}>
                      {recording === c.id ? (
                        <span className="animate-pulse text-primary">Press keys…</span>
                      ) : c.keybinding ? (
                        <Kbd className={cn("h-5 px-1.5 text-[0.6875rem]", clash.length && "border-verdict-tle text-verdict-tle")}>
                          {ctx.commands.formatKeybinding(c.keybinding)}
                        </Kbd>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </button>
                    {clash.length > 0 && <div className="text-[0.625rem] text-verdict-tle">Also bound to {clash.map((x) => x.title).join(", ")}</div>}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                      <Tooltip content="Change">
                        <Button variant="ghost" size="icon-sm" onClick={() => record(c)}>
                          <Pencil />
                        </Button>
                      </Tooltip>
                      {c.keybinding && (
                        <Tooltip content="Remove shortcut">
                          <Button variant="ghost" size="icon-sm" onClick={() => ctx.commands.setKeybinding(c.id, "")}>
                            <X />
                          </Button>
                        </Tooltip>
                      )}
                      {custom && (
                        <Tooltip content={`Reset to ${c.defaultKeybinding ? ctx.commands.formatKeybinding(c.defaultKeybinding) : "none"}`}>
                          <Button variant="ghost" size="icon-sm" onClick={() => ctx.commands.setKeybinding(c.id, null)}>
                            <RotateCcw />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
