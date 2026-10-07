import { Component, type ReactNode } from "react";
import { DockviewReact, type DockviewTheme, type IDockviewPanelProps } from "dockview-react";
import { PANEL_COMPONENT, layout } from "../core/layout.ts";
import { useRegistry } from "../core/registry.ts";
import { useTheme } from "../core/theme.ts";

const theme: DockviewTheme = {
  name: "cp",
  className: "dockview-theme-cp",
  gap: 6,
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "group",
};

class PanelErrorBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="space-y-2 p-4 text-xs">
        <div className="font-medium text-destructive">Panel "{this.props.name}" crashed</div>
        <pre className="font-mono whitespace-pre-wrap text-muted-foreground">{this.state.error.message}</pre>
        <button className="cursor-pointer text-primary hover:underline" onClick={() => this.setState({ error: null })}>
          Retry
        </button>
      </div>
    );
  }
}

function PluginPanel({ params }: IDockviewPanelProps<{ panelId: string }>) {
  const panel = useRegistry((s) => s.panels.find((p) => p.id === params.panelId));
  if (!panel) {
    return <div className="p-4 text-xs text-muted-foreground">This panel's plugin is not loaded.</div>;
  }
  const C = panel.component;
  return (
    <PanelErrorBoundary name={panel.title}>
      <div className="h-full overflow-hidden">
        <C ctx={panel.owner} />
      </div>
    </PanelErrorBoundary>
  );
}

function Watermark() {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      Nothing open — reopen panels from the View menu.
    </div>
  );
}

const components = { [PANEL_COMPONENT]: PluginPanel };

export function Dock() {
  const resolved = useTheme((s) => s.resolved);
  return (
    <div className={`h-full ${resolved === "dark" ? "dockview-theme-dark" : "dockview-theme-light"}`}>
      <DockviewReact
        theme={theme}
        components={components}
        watermarkComponent={Watermark}
        defaultRenderer="always"
        onReady={(e) => layout.init(e.api)}
      />
    </div>
  );
}
