import { LayoutPanelLeft, Settings } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Tooltip,
} from "@cp-ide/ui";
import { formatKeybinding } from "../core/keybindings.ts";
import { layout, useLayout } from "../core/layout.ts";
import { registry, useRegistry } from "../core/registry.ts";
import { useWorkspace } from "../core/workspace.ts";

function ViewMenu() {
  const panels = useRegistry((s) => s.panels);
  const commands = useRegistry((s) => s.commands);
  const open = useLayout((s) => s.open);
  const sorted = [...panels].sort((a, b) => a.title.localeCompare(b.title));
  return (
    <DropdownMenu>
      <Tooltip content="View">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="View">
            <LayoutPanelLeft />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Panels</DropdownMenuLabel>
        {sorted.map((p) => {
          const kb = commands.find((c) => c.id === `view.toggle.${p.id}`)?.keybinding;
          return (
            <DropdownMenuCheckboxItem
              key={p.id}
              checked={open.includes(p.id)}
              onCheckedChange={(checked) => (checked ? layout.open(p.id) : layout.close(p.id))}
              onSelect={(e) => e.preventDefault()}
            >
              {p.title}
              {kb && <DropdownMenuShortcut>{formatKeybinding(kb)}</DropdownMenuShortcut>}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => layout.reset()}>Reset layout</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar() {
  const toolbar = useRegistry((s) => s.toolbar);
  const problem = useWorkspace((s) => s.problem);
  const items = [...toolbar].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 px-3">
      <div className="flex items-center gap-2">
        <div className="flex size-5 items-center justify-center rounded bg-primary font-mono text-[0.625rem] font-bold text-primary-foreground">
          cp
        </div>
        {problem ? (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium">{problem.meta.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {problem.meta.platform} / {problem.meta.group}
            </span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">cp-ide</span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center gap-1.5">
        {items.map((i) => (
          <i.component key={i.id} ctx={i.owner} />
        ))}
      </div>
      <div className="flex items-center gap-0.5">
        <ViewMenu />
        <Tooltip content={`Settings (${formatKeybinding("ctrl+,")})`}>
          <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => registry.command("settings.open")?.run()}>
            <Settings />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
