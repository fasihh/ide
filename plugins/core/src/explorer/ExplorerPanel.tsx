import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FilePlus2, RefreshCw, Search, Zap } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import type { ProblemStatus, ProblemSummary } from "@cp-ide/shared";
import { Button, Input, Tooltip, cn } from "@cp-ide/ui";

const STATUS_DOT: Record<ProblemStatus, string> = {
  todo: "bg-muted-foreground/40",
  attempted: "bg-verdict-tle",
  solved: "bg-verdict-ac",
};

type Tree = Map<string, Map<string, ProblemSummary[]>>;

function buildTree(problems: ProblemSummary[]): Tree {
  const tree: Tree = new Map();
  const sorted = [...problems].sort((a, b) => a.platform.localeCompare(b.platform) || b.group.localeCompare(a.group) || a.name.localeCompare(b.name));
  for (const p of sorted) {
    let groups = tree.get(p.platform);
    if (!groups) tree.set(p.platform, (groups = new Map()));
    let list = groups.get(p.group);
    if (!list) groups.set(p.group, (list = []));
    list.push(p);
  }
  return tree;
}

function Row({
  depth,
  open,
  label,
  count,
  onClick,
}: {
  depth: number;
  open: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-6 w-full cursor-pointer items-center gap-1 rounded-sm pr-2 text-left text-xs hover:bg-accent"
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={onClick}
    >
      {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate font-medium">{label}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}

export function ExplorerPanel({ ctx }: PanelProps) {
  const problems = ctx.workspace.use((s) => s.problems);
  const loading = ctx.workspace.use((s) => s.problemsLoading);
  const active = ctx.workspace.use((s) => s.problem?.id);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return problems;
    return problems.filter((p) => `${p.name} ${p.platform} ${p.group} ${p.tags.join(" ")}`.toLowerCase().includes(q));
  }, [problems, query]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-6 pl-7" placeholder="Filter problems" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Tooltip content="New scratch problem (Alt+N)">
          <Button variant="ghost" size="icon-sm" onClick={() => ctx.commands.execute("workspace.newScratch")}>
            <Zap />
          </Button>
        </Tooltip>
        <Tooltip content="New problem (Alt+Shift+N)">
          <Button variant="ghost" size="icon-sm" onClick={() => ctx.commands.execute("workspace.newProblem")}>
            <FilePlus2 />
          </Button>
        </Tooltip>
        <Tooltip content="Refresh">
          <Button variant="ghost" size="icon-sm" onClick={() => ctx.workspace.refreshProblems()}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {[...tree].map(([platform, groups]) => {
          const pk = platform;
          const platformOpen = !collapsed.has(pk) || !!query;
          return (
            <div key={pk}>
              <Row depth={0} open={platformOpen} label={platform} count={[...groups.values()].reduce((n, l) => n + l.length, 0)} onClick={() => toggle(pk)} />
              {platformOpen &&
                [...groups].map(([group, list]) => {
                  const gk = `${platform}/${group}`;
                  const groupOpen = !collapsed.has(gk) || !!query;
                  return (
                    <div key={gk}>
                      <Row depth={1} open={groupOpen} label={group} count={list.length} onClick={() => toggle(gk)} />
                      {groupOpen &&
                        list.map((p) => (
                          <button
                            key={p.id}
                            title={p.id}
                            onClick={() => ctx.workspace.openProblem(p.id)}
                            className={cn(
                              "flex h-6 w-full cursor-pointer items-center gap-2 rounded-sm pr-2 pl-[34px] text-left text-xs hover:bg-accent",
                              p.id === active && "bg-accent text-accent-foreground",
                            )}
                          >
                            <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[p.status])} />
                            <span className="truncate">{p.name}</span>
                            <span className="ml-auto text-[10px] text-muted-foreground uppercase">{p.language === "cpp" ? "c++" : "py"}</span>
                          </button>
                        ))}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {problems.length === 0 && !loading && (
          <div className="space-y-1 px-2 py-6 text-center text-xs text-muted-foreground">
            <div>No problems yet.</div>
            <button className="cursor-pointer text-primary hover:underline" onClick={() => ctx.commands.execute("workspace.newScratch")}>
              Start a scratch problem
            </button>
          </div>
        )}
        {problems.length > 0 && filtered.length === 0 && <div className="px-2 py-4 text-center text-xs text-muted-foreground">No matches.</div>}
      </div>
    </div>
  );
}
