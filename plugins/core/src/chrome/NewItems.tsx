import { ChevronDown, FilePlus2 } from "lucide-react";
import type { NewItemContribution, PanelProps } from "@cp-ide/plugin-api/web";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger, Kbd } from "@cp-ide/ui";
import { NewProblemDialog } from "./NewProblemDialog.tsx";

/** The effective (user-overridable) shortcut of each entry's command. */
function useShortcuts(ctx: PanelProps["ctx"]) {
  const commands = ctx.commands.useList();
  return (item: NewItemContribution) => {
    const binding = commands.find((c) => c.id === item.command)?.keybinding;
    return binding ? ctx.commands.formatKeybinding(binding) : undefined;
  };
}

/** The registered entries as menu items, for any dropdown that offers "new …". */
export function NewItemsMenuItems({ ctx }: PanelProps) {
  const items = ctx.newItems.useList();
  const shortcut = useShortcuts(ctx);
  return (
    <>
      {items.map((item) => {
        const Icon = item.icon ?? FilePlus2;
        const keys = shortcut(item);
        return (
          <DropdownMenuItem key={item.id} onSelect={() => void ctx.commands.execute(item.command)}>
            <Icon /> {item.label}
            {keys && <DropdownMenuShortcut>{keys}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

/** Top bar "New ▾": everything plugins registered with `ctx.newItems`. */
export function NewMenu({ ctx }: PanelProps) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            New <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-52">
          <NewItemsMenuItems ctx={ctx} />
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProblemDialog ctx={ctx} />
    </>
  );
}

/** The same entries as cards, for the editor when no problem is open. */
export function NewItemCards({ ctx }: PanelProps) {
  const items = ctx.newItems.useList();
  const shortcut = useShortcuts(ctx);
  return (
    <div className="grid w-full max-w-md gap-1.5">
      {items.map((item) => {
        const Icon = item.icon ?? FilePlus2;
        const keys = shortcut(item);
        return (
          <button
            key={item.id}
            className="flex cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent"
            onClick={() => void ctx.commands.execute(item.command)}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-foreground">{item.label}</span>
              {item.description && <span className="block truncate text-[0.6875rem] text-muted-foreground">{item.description}</span>}
            </span>
            {keys && <Kbd>{keys}</Kbd>}
          </button>
        );
      })}
    </div>
  );
}
