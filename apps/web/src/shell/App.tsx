import { Toaster } from "sonner";
import { TooltipProvider } from "@cp-ide/ui";
import { useTheme } from "../core/theme.ts";
import { useRegistry } from "../core/registry.ts";
import { Dock } from "./Dock.tsx";
import { QuickInput } from "./QuickInput.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { TopBar } from "./TopBar.tsx";

export function App() {
  const resolved = useTheme((s) => s.resolved);
  const overlays = useRegistry((s) => s.overlays);
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background">
        <TopBar />
        <main className="min-h-0 flex-1 px-1.5">
          <Dock />
        </main>
        <StatusBar />
      </div>
      {overlays.map((o) => (
        <o.component key={o.id} ctx={o.owner} />
      ))}
      <QuickInput />
      <Toaster theme={resolved} position="bottom-right" toastOptions={{ className: "text-xs" }} />
    </TooltipProvider>
  );
}
