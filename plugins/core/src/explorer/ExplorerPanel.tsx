import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FilePlus2,
  FolderInput,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type { PanelProps, WebPluginContext } from "@cp-ide/plugin-api/web";
import type { ProblemStatus, ProblemSummary } from "@cp-ide/shared";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  cn,
} from "@cp-ide/ui";
import { openNewProblemDialog } from "../chrome/NewProblemDialog.tsx";
import { copyPath, deleteProblem, moveProblem, renameProblem, setStatus } from "./actions.ts";

const STATUS_DOT: Record<ProblemStatus, string> = {
  todo: "bg-muted-foreground/40",
  attempted: "bg-verdict-tle",
  solved: "bg-verdict-ac",
};
const STATUS_LABEL: Record<ProblemStatus, string> = { todo: "To do", attempted: "Tried", solved: "Solved" };
const STATUS_RANK: Record<ProblemStatus, number> = { attempted: 0, todo: 1, solved: 2 };
const RECENT_COUNT = 5;

type Sort = "recent" | "name" | "status";
type ViewState = { sort: Sort; status: ProblemStatus | "all"; tags: string[]; collapsed: string[]; recentOpen: boolean };
const VIEW_KEY = "cp-ide.explorer.v1";
const DEFAULT_VIEW: ViewState = { sort: "recent", status: "all", tags: [], collapsed: [], recentOpen: true };

function useViewState() {
  const [view, setView] = useState<ViewState>(() => {
    try {
      return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") };
    } catch {
      return DEFAULT_VIEW;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {}
  }, [view]);
  return [view, (patch: Partial<ViewState>) => setView((v) => ({ ...v, ...patch }))] as const;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function compare(sort: Sort) {
  return (a: ProblemSummary, b: ProblemSummary) =>
    sort === "recent"
      ? b.updatedAt.localeCompare(a.updatedAt)
      : sort === "status"
        ? STATUS_RANK[a.status] - STATUS_RANK[b.status] || byName(a.name, b.name)
        : byName(a.name, b.name);
}

type Tree = [platform: string, groups: [group: string, problems: ProblemSummary[]][]][];

function buildTree(problems: ProblemSummary[], sort: Sort): Tree {
  const map = new Map<string, Map<string, ProblemSummary[]>>();
  for (const p of problems) {
    let groups = map.get(p.platform);
    if (!groups) map.set(p.platform, (groups = new Map()));
    groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  }
  const latest = (list: ProblemSummary[]) => list.reduce((m, p) => (p.updatedAt > m ? p.updatedAt : m), "");
  return [...map]
    .map(([platform, groups]) => {
      const sorted = [...groups].map(([g, list]) => [g, [...list].sort(compare(sort))] as [string, ProblemSummary[]]);
      sorted.sort(([ga, la], [gb, lb]) => (sort === "recent" ? latest(lb).localeCompare(latest(la)) : byName(ga, gb)));
      return [platform, sorted] as [string, [string, ProblemSummary[]][]];
    })
    .sort(([a, ga], [b, gb]) =>
      sort === "recent" ? latest(gb.flatMap(([, l]) => l)).localeCompare(latest(ga.flatMap(([, l]) => l))) : byName(a, b),
    );
}

function ProblemMenu({ ctx, p }: { ctx: WebPluginContext; p: ProblemSummary }) {
  return (
    <ContextMenuContent>
      <ContextMenuLabel className="max-w-56 truncate">{p.name}</ContextMenuLabel>
      <ContextMenuItem onSelect={() => ctx.workspace.openProblem(p.id)}>Open</ContextMenuItem>
      <ContextMenuItem onSelect={() => renameProblem(ctx, p.id)}>
        <Pencil /> Rename…
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => moveProblem(ctx, p.id)}>
        <FolderInput /> Move to…
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className={cn("size-2 rounded-full", STATUS_DOT[p.status])} /> Status
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {(["todo", "attempted", "solved"] as const).map((s) => (
            <ContextMenuItem key={s} onSelect={() => setStatus(ctx, p.id, s)}>
              <span className={cn("size-2 rounded-full", STATUS_DOT[s])} /> {STATUS_LABEL[s]}
              {p.status === s && <span className="ml-auto text-muted-foreground">current</span>}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => copyPath(ctx, p.id)}>
        <Copy /> Copy folder path
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => deleteProblem(ctx, p.id)}>
        <Trash2 /> Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

/** Open the row's context menu from the hover "⋯" button. */
function openMenu(e: React.MouseEvent) {
  e.stopPropagation();
  const row = (e.currentTarget as HTMLElement).closest("[data-row]");
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left, clientY: r.bottom }));
}

function ProblemRow({ ctx, p, active, indent, showGroup }: { ctx: WebPluginContext; p: ProblemSummary; active: boolean; indent: number; showGroup?: boolean }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-row
          title={`${p.id}${p.tags.length ? `\n${p.tags.join(", ")}` : ""}`}
          onClick={() => ctx.workspace.openProblem(p.id)}
          style={{ paddingLeft: indent }}
          className={cn(
            "group flex h-6 cursor-pointer items-center gap-2 rounded-sm pr-1 text-xs select-none hover:bg-accent",
            active && "bg-accent text-accent-foreground",
          )}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[p.status])} />
          <span className="truncate">{p.name}</span>
          {showGroup && <span className="truncate text-[0.625rem] text-muted-foreground">{p.group}</span>}
          <span className="ml-auto shrink-0 text-[0.625rem] text-muted-foreground uppercase group-hover:hidden">{p.language === "cpp" ? "c++" : "py"}</span>
          <button
            aria-label="Problem actions"
            className="ml-auto hidden size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground group-hover:flex hover:bg-background/60 hover:text-foreground"
            onClick={openMenu}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ProblemMenu ctx={ctx} p={p} />
    </ContextMenu>
  );
}

async function renameGroup(ctx: WebPluginContext, platform: string, group: string, list: ProblemSummary[]) {
  const name = await ctx.ui.prompt({ title: `Rename contest "${group}"`, value: group, validate: (v) => (!v.trim() ? "Enter a name" : undefined) });
  if (!name?.trim() || name.trim() === group) return;
  for (const p of list) {
    await ctx.workspace.moveProblem(p.id, { platform, group: name.trim() }).catch((e) => ctx.notify.error(`Could not move ${p.name}`, String(e?.message ?? e)));
  }
}

function GroupRow({
  depth,
  open,
  label,
  count,
  solved,
  onClick,
  menu,
}: {
  depth: number;
  open: boolean;
  label: React.ReactNode;
  count: number;
  solved?: number;
  onClick: () => void;
  menu?: React.ReactNode;
}) {
  const row = (
    <div
      data-row
      className="flex h-6 w-full cursor-pointer items-center gap-1 rounded-sm pr-2 text-left text-xs select-none hover:bg-accent"
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={onClick}
    >
      {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="truncate font-medium">{label}</span>
      <span className="ml-auto shrink-0 text-[0.625rem] text-muted-foreground tabular-nums">{solved !== undefined ? `${solved}/${count}` : count}</span>
    </div>
  );
  if (!menu) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      {menu}
    </ContextMenu>
  );
}

export function ExplorerPanel({ ctx }: PanelProps) {
  const problems = ctx.workspace.use((s) => s.problems);
  const loading = ctx.workspace.use((s) => s.problemsLoading);
  const active = ctx.workspace.use((s) => s.problem?.id);
  const [query, setQuery] = useState("");
  const [view, setView] = useViewState();

  const allTags = useMemo(() => [...new Set(problems.flatMap((p) => p.tags))].sort(byName), [problems]);
  const counts = useMemo(() => {
    const c = { all: problems.length, todo: 0, attempted: 0, solved: 0 };
    for (const p of problems) c[p.status]++;
    return c;
  }, [problems]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return problems.filter(
      (p) =>
        (view.status === "all" || p.status === view.status) &&
        view.tags.every((t) => p.tags.includes(t)) &&
        (!q || `${p.name} ${p.platform} ${p.group} ${p.tags.join(" ")}`.toLowerCase().includes(q)),
    );
  }, [problems, query, view.status, view.tags]);

  const tree = useMemo(() => buildTree(filtered, view.sort), [filtered, view.sort]);
  const filtering = !!query.trim() || view.status !== "all" || view.tags.length > 0;
  const recent = useMemo(() => (filtering ? [] : [...problems].sort(compare("recent")).slice(0, RECENT_COUNT)), [problems, filtering]);
  const collapsed = new Set(view.collapsed);
  const toggle = (key: string) =>
    setView({ collapsed: collapsed.has(key) ? view.collapsed.filter((k) => k !== key) : [...view.collapsed, key] });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 px-2">
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

      <div className="flex shrink-0 items-center gap-1 border-b px-2 pb-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {(["all", "todo", "attempted", "solved"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setView({ status: s })}
              className={cn(
                "flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 text-[0.625rem] whitespace-nowrap",
                view.status === s ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s !== "all" && <span className={cn("size-1.5 rounded-full", STATUS_DOT[s])} />}
              {s === "all" ? "All" : STATUS_LABEL[s]}
              <span className="tabular-nums opacity-60">{counts[s]}</span>
            </button>
          ))}
        </div>
        {allTags.length > 0 && (
          <DropdownMenu>
            <Tooltip content="Filter by tag">
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 text-[0.625rem]",
                    view.tags.length ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Tag className="size-3" />
                  {view.tags.length > 0 && view.tags.length}
                </button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" className="max-h-72">
              <DropdownMenuLabel>Tags (all must match)</DropdownMenuLabel>
              {allTags.map((t) => (
                <DropdownMenuCheckboxItem
                  key={t}
                  checked={view.tags.includes(t)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => setView({ tags: on ? [...view.tags, t] : view.tags.filter((x) => x !== t) })}
                >
                  {t}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <DropdownMenu>
          <Tooltip content="Sort">
            <DropdownMenuTrigger asChild>
              <button className="flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded px-1 text-[0.625rem] text-muted-foreground hover:text-foreground">
                <ArrowUpDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            {(
              [
                ["recent", "Recently changed"],
                ["name", "Name"],
                ["status", "Status (tried first)"],
              ] as const
            ).map(([id, label]) => (
              <DropdownMenuCheckboxItem key={id} checked={view.sort === id} onCheckedChange={() => setView({ sort: id })}>
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {filtering && (
          <Tooltip content="Clear filters">
            <button
              className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => {
                setQuery("");
                setView({ status: "all", tags: [] });
              }}
            >
              <X className="size-3" />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {recent.length > 0 && (
          <div className="mb-1 border-b pb-1">
            <GroupRow
              depth={0}
              open={view.recentOpen}
              label={
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-3" /> Recent
                </span>
              }
              count={recent.length}
              onClick={() => setView({ recentOpen: !view.recentOpen })}
            />
            {view.recentOpen &&
              recent.map((p) => <ProblemRow key={`recent:${p.id}`} ctx={ctx} p={p} active={p.id === active} indent={22} showGroup />)}
          </div>
        )}

        {tree.map(([platform, groups]) => {
          const all = groups.flatMap(([, l]) => l);
          const platformOpen = !collapsed.has(platform) || filtering;
          return (
            <div key={platform}>
              <GroupRow
                depth={0}
                open={platformOpen}
                label={platform}
                count={all.length}
                solved={all.filter((p) => p.status === "solved").length}
                onClick={() => toggle(platform)}
              />
              {platformOpen &&
                groups.map(([group, list]) => {
                  const key = `${platform}/${group}`;
                  const groupOpen = !collapsed.has(key) || filtering;
                  return (
                    <div key={key}>
                      <GroupRow
                        depth={1}
                        open={groupOpen}
                        label={group}
                        count={list.length}
                        solved={list.filter((p) => p.status === "solved").length}
                        onClick={() => toggle(key)}
                        menu={
                          <ContextMenuContent>
                            <ContextMenuLabel>{group}</ContextMenuLabel>
                            <ContextMenuItem onSelect={() => openNewProblemDialog({ platform, group })}>
                              <FilePlus2 /> New problem here…
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => renameGroup(ctx, platform, group, list)}>
                              <Pencil /> Rename contest…
                            </ContextMenuItem>
                          </ContextMenuContent>
                        }
                      />
                      {groupOpen && list.map((p) => <ProblemRow key={p.id} ctx={ctx} p={p} active={p.id === active} indent={34} />)}
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
