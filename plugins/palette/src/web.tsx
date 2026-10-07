import { Search } from "lucide-react";
import { type PanelProps, definePlugin } from "@cp-ide/plugin-api/web";
import { Kbd } from "@cp-ide/ui";
import { Palette } from "./Palette.tsx";
import { builtinProviders } from "./providers.ts";
import { addProvider, closePalette, openPalette } from "./store.ts";
import type { PaletteService } from "./types.ts";

/** Top-bar entry point, like VS Code's command center. */
function SearchBox({ ctx }: PanelProps) {
  const commands = ctx.commands.useList();
  const binding = commands.find((c) => c.id === "workbench.quickOpen")?.keybinding;
  return (
    <button
      onClick={() => openPalette("")}
      className="flex h-7 w-[min(22rem,32vw)] cursor-pointer items-center gap-2 rounded-md border border-input bg-background/40 px-2 text-xs text-muted-foreground transition-colors hover:border-ring/60 hover:text-foreground"
    >
      <Search className="size-3.5 shrink-0" />
      <span className="truncate">Search problems, panels, commands…</span>
      {binding && <Kbd className="ml-auto shrink-0">{ctx.commands.formatKeybinding(binding)}</Kbd>}
    </button>
  );
}

export default definePlugin({
  id: "palette",
  name: "Command Palette",
  description: "Search problems and files, run commands, open panels, switch layouts, go to line.",

  activate(ctx) {
    const service: PaletteService = {
      registerProvider: (provider) => addProvider(provider),
      open: (query = "") => openPalette(query),
      close: closePalette,
    };
    ctx.services.provide("palette", service);
    for (const provider of builtinProviders(ctx)) service.registerProvider(provider);

    ctx.overlays.register({ id: "palette.overlay", component: Palette });
    ctx.toolbar.register({ id: "palette.search", order: -10, component: SearchBox });

    ctx.commands.register({ id: "workbench.quickOpen", title: "Search problems and files", category: "Go", keybinding: "ctrl+p", run: () => openPalette("") });
    ctx.commands.register({ id: "workbench.commandPalette", title: "Command palette", category: "View", keybinding: "ctrl+shift+p", run: () => openPalette(">") });
    ctx.commands.register({ id: "palette.panels", title: "Open panel…", category: "View", keybinding: "ctrl+alt+p", run: () => openPalette("#") });
    ctx.commands.register({ id: "palette.layouts", title: "Switch layout…", category: "Layout", run: () => openPalette("!") });
    ctx.commands.register({ id: "palette.gotoLine", title: "Go to line…", category: "Go", keybinding: "ctrl+g", run: () => openPalette(":") });
  },
});
