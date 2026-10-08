import { Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tooltip,
  cn,
} from "@cp-ide/ui";
import { NewItemsMenuItems } from "../chrome/NewItems.tsx";
import { SORTS, STATUS_DOT, STATUS_LABEL, type StatusCounts, type ViewState } from "./view.ts";

type Props = PanelProps & {
  query: string;
  setQuery: (q: string) => void;
  view: ViewState;
  setView: (patch: Partial<ViewState>) => void;
  counts: StatusCounts;
  allTags: string[];
  loading: boolean;
};

const STATUSES = ["all", "todo", "attempted", "solved"] as const;

/**
 * One row: search (with a view-options button inside it) and a New menu. Status, tags and sort live in
 * the options menu; while any filter is on, it shows as a removable chip under the search.
 */
export function ExplorerToolbar({ ctx, query, setQuery, view, setView, counts, allTags, loading }: Props) {
  const activeFilters = (view.status !== "all" ? 1 : 0) + view.tags.length;
  const toggleTag = (t: string) => setView({ tags: view.tags.includes(t) ? view.tags.filter((x) => x !== t) : [...view.tags, t] });

  return (
    <div className="shrink-0 border-b px-2 py-1.5">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-7 pr-8 pl-7" placeholder="Filter problems" value={query} onChange={(e) => setQuery(e.target.value)} />
          <DropdownMenu>
            <Tooltip content="Status, tags and sort">
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="View options"
                  className={cn(
                    "absolute top-1/2 right-1 flex h-5 -translate-y-1/2 cursor-pointer items-center gap-0.5 rounded px-1 text-[0.625rem]",
                    activeFilters ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <SlidersHorizontal className="size-3" />
                  {activeFilters > 0 && <span className="tabular-nums">{activeFilters}</span>}
                </button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end" className="max-h-96 min-w-48">
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              {STATUSES.map((s) => (
                <DropdownMenuCheckboxItem key={s} checked={view.status === s} onSelect={(e) => e.preventDefault()} onCheckedChange={() => setView({ status: s })}>
                  {s !== "all" && <span className={cn("size-1.5 rounded-full", STATUS_DOT[s])} />}
                  <span className="flex-1">{s === "all" ? "All" : STATUS_LABEL[s]}</span>
                  <span className="text-muted-foreground tabular-nums">{counts[s]}</span>
                </DropdownMenuCheckboxItem>
              ))}
              {allTags.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Tags (all must match)</DropdownMenuLabel>
                  {allTags.map((t) => (
                    <DropdownMenuCheckboxItem key={t} checked={view.tags.includes(t)} onSelect={(e) => e.preventDefault()} onCheckedChange={() => toggleTag(t)}>
                      {t}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              {SORTS.map(([id, label]) => (
                <DropdownMenuCheckboxItem key={id} checked={view.sort === id} onCheckedChange={() => setView({ sort: id })}>
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => ctx.workspace.refreshProblems()}>
                <RefreshCw className={cn(loading && "animate-spin")} /> Refresh list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <DropdownMenu>
          <Tooltip content="New">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="New">
                <Plus />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-52">
            <NewItemsMenuItems ctx={ctx} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {activeFilters > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {view.status !== "all" && (
            <FilterChip onRemove={() => setView({ status: "all" })}>
              <span className={cn("size-1.5 rounded-full", STATUS_DOT[view.status])} />
              {STATUS_LABEL[view.status]}
            </FilterChip>
          )}
          {view.tags.map((t) => (
            <FilterChip key={t} onRemove={() => toggleTag(t)}>
              #{t}
            </FilterChip>
          ))}
          <button className="cursor-pointer px-1 text-[0.625rem] text-muted-foreground hover:text-foreground" onClick={() => setView({ status: "all", tags: [] })}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function FilterChip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="flex h-5 items-center gap-1 rounded bg-accent pr-0.5 pl-1.5 text-[0.625rem] text-foreground">
      {children}
      <button className="flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label="Remove filter" onClick={onRemove}>
        <X className="size-2.5" />
      </button>
    </span>
  );
}
