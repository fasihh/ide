import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import type { SettingDescriptor } from "@cp-ide/shared";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea, Tooltip, cn } from "@cp-ide/ui";

function TextControl({ value, onCommit, multiline, placeholder }: { value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return multiline ? (
    <Textarea className="min-h-16" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />
  ) : (
    <Input
      className="font-mono"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NumberControl({ value, d, onCommit }: { value: number; d: Extract<SettingDescriptor, { type: "number" }>; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || Number.isNaN(n)) return setDraft(String(value));
    const clamped = Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, n));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <Input
      type="number"
      className="w-32 font-mono"
      value={draft}
      min={d.min}
      max={d.max}
      step={d.step ?? "any"}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function PluginsControl({ ctx, value, onCommit }: { ctx: WebPluginContext; value: string[]; onCommit: (v: string[]) => void }) {
  const plugins = ctx.plugins.list();
  const [changed, setChanged] = useState(false);
  return (
    <div className="w-full space-y-1.5">
      {plugins.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-md border px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium">
              {p.name}
              <span className="font-mono text-[10px] font-normal text-muted-foreground">{p.id}</span>
              {p.hasServer && <span className="rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">server</span>}
            </div>
            {p.description && <div className="truncate text-[11px] text-muted-foreground">{p.description}</div>}
          </div>
          <Switch
            checked={!value.includes(p.id)}
            disabled={p.required}
            onCheckedChange={(on) => {
              setChanged(true);
              onCommit(on ? value.filter((x) => x !== p.id) : [...value, p.id]);
            }}
          />
        </div>
      ))}
      {changed && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Reload to apply plugin changes.
          <Button size="sm" variant="outline" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      )}
    </div>
  );
}

function Control({ ctx, k, d, value, update }: { ctx: WebPluginContext; k: string; d: SettingDescriptor; value: unknown; update: (v: unknown) => void }) {
  if (k === "plugins.disabled") return <PluginsControl ctx={ctx} value={value as string[]} onCommit={update} />;
  switch (d.type) {
    case "boolean":
      return <Switch checked={!!value} onCheckedChange={update} />;
    case "number":
      return <NumberControl value={value as number} d={d} onCommit={update} />;
    case "enum":
      return (
        <Select value={String(value)} onValueChange={update}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {d.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "stringList":
      return (
        <TextControl
          value={(value as string[]).join(", ")}
          onCommit={(v) =>
            update(
              v
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            )
          }
        />
      );
    default:
      return <TextControl value={String(value ?? "")} multiline={d.multiline} placeholder={d.placeholder} onCommit={update} />;
  }
}

/** Rendered from descriptors, so settings contributed by plugins show up automatically. */
export function SettingsPanel({ ctx }: PanelProps) {
    const { descriptors, values, overrides } = ctx.settings.useSchema();
    const [query, setQuery] = useState("");

    const sections = useMemo(() => {
      const q = query.trim().toLowerCase();
      const out = new Map<string, [string, SettingDescriptor][]>();
      for (const [k, d] of Object.entries(descriptors)) {
        if (q && !`${k} ${d.label} ${d.description ?? ""} ${d.section}`.toLowerCase().includes(q)) continue;
        let list = out.get(d.section);
        if (!list) out.set(d.section, (list = []));
        list.push([k, d]);
      }
      return [...out];
    }, [descriptors, query]);

    return (
      <div className="flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center gap-3 border-b px-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-7" placeholder="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <span className="truncate text-[11px] text-muted-foreground">Saved to ~/.cp-ide/settings.json</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-4">
            {sections.map(([section, items]) => (
              <section key={section}>
                <h3 className="mb-1 text-sm font-semibold">{section}</h3>
                <div className="divide-y">
                  {items.map(([k, d]) => {
                    const value = k in values ? values[k] : d.default;
                    const modified = k in overrides;
                    const wide = d.type === "string" || d.type === "stringList" || k === "plugins.disabled";
                    return (
                      <div key={k} className={cn("flex gap-4 py-3", wide ? "flex-col" : "items-center")}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs font-medium">
                            {modified && <span className="size-1.5 rounded-full bg-primary" title="Modified" />}
                            {d.label}
                            <span className="font-mono text-[10px] font-normal text-muted-foreground">{k}</span>
                            {modified && (
                              <Tooltip content="Reset to default">
                                <button className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => ctx.settings.update({ [k]: null })}>
                                  <RotateCcw className="size-3" />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                          {d.description && <div className="mt-0.5 text-[11px] text-muted-foreground">{d.description}</div>}
                        </div>
                        <div className={cn(wide && "w-full")}>
                          <Control ctx={ctx} k={k} d={d} value={value} update={(v) => void ctx.settings.update({ [k]: v }).catch(() => {})} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {sections.length === 0 && <div className="text-xs text-muted-foreground">No settings match “{query}”.</div>}
          </div>
        </div>
      </div>
    );
}
