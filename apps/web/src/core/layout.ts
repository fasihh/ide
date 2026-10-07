import { create } from "zustand";
import type { DockviewApi, SerializedDockview } from "dockview-react";
import type { LayoutPreset, PanelContribution } from "@cp-ide/plugin-api/web";
import { toDisposable } from "@cp-ide/plugin-api/web";
import { registry, useRegistry } from "./registry.ts";

const LAYOUT_KEY = "cp-ide.layout.v1";
const PINNED_KEY = "cp-ide.layout.pinned.v1";
const SAVED_KEY = "cp-ide.layout.saved.v1";
/** Every plugin panel is rendered through this one dockview component; params carry the panel id. */
export const PANEL_COMPONENT = "plugin-panel";

type Placement = NonNullable<PanelContribution["placement"]>;
type Pinned = Partial<Record<"left" | "right" | "bottom", number>>;
type SavedLayout = { id: string; name: string; json: SerializedDockview; pinned: Pinned };

export const useLayout = create<{ open: string[]; presets: LayoutPreset[]; saved: SavedLayout[] }>(() => ({
  open: [],
  presets: [],
  saved: readJson<SavedLayout[]>(SAVED_KEY) ?? [],
}));

let dock: DockviewApi | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Pixel sizes of the side/bottom groups. Re-applied after window resizes so the editor absorbs them. */
let pinned: Pinned = readJson<Pinned>(PINNED_KEY) ?? {};
let resizingUntil = 0;
/** Sizes to apply once the dock has real dimensions (it can be 0×0 when built in a hidden tab). */
let pendingSizes: Pinned | null = null;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const placementOf = (panelId: string): Placement => registry.panel(panelId)?.placement ?? "center";
const clamp = (min: number, v: number, max: number) => Math.round(Math.min(max, Math.max(min, v)));

/** Default side sizes, relative to the window so the editor keeps most of the space. */
function defaultSizes() {
  const w = dock?.width || window.innerWidth;
  const h = dock?.height || window.innerHeight;
  return { left: clamp(200, w * 0.17, 300), right: clamp(340, w * 0.32, 620), bottom: clamp(120, h * 0.22, 260) };
}

function syncOpen() {
  if (dock) useLayout.setState({ open: dock.panels.map((p) => p.id) });
}

/** The group holding panels of a placement (judged by the group's active panel). */
function groupFor(placement: Placement) {
  return dock?.groups.find((g) => {
    const p = g.activePanel ?? g.panels[0];
    return p && placementOf(p.id) === placement;
  });
}

function rememberSizes() {
  if (!dock || pendingSizes || Date.now() < resizingUntil) return;
  const next: Pinned = {};
  for (const placement of ["left", "right", "bottom"] as const) {
    const g = groupFor(placement);
    if (g) next[placement] = placement === "bottom" ? g.height : g.width;
  }
  pinned = { ...pinned, ...next };
  writeJson(PINNED_KEY, pinned);
}

function applyPinnedSizes() {
  if (!dock || !dock.width) return;
  for (const placement of ["left", "right", "bottom"] as const) {
    const size = pinned[placement];
    const g = groupFor(placement);
    if (!g || !size) continue;
    // Never let side panels crowd the editor out on small windows.
    const max = placement === "bottom" ? dock.height * 0.6 : dock.width * 0.45;
    g.api.setSize(placement === "bottom" ? { height: Math.min(size, max) } : { width: Math.min(size, max) });
  }
}

/** An open panel that shares `placement`, used to dock new panels into the same group. */
function openSibling(placement: Placement, exclude?: string) {
  return dock?.panels.find((p) => p.id !== exclude && placementOf(p.id) === placement);
}

function addPanel(contribution: PanelContribution, inactive = false) {
  if (!dock) return;
  const placement = contribution.placement ?? "center";
  const base = {
    id: contribution.id,
    component: PANEL_COMPONENT,
    title: contribution.title,
    params: { panelId: contribution.id },
    inactive,
  };
  const sibling = openSibling(placement, contribution.id);
  if (sibling) {
    dock.addPanel({ ...base, position: { referencePanel: sibling.id, direction: "within" } });
    return;
  }
  const center = openSibling("center", contribution.id);
  const sizes = defaultSizes();
  switch (placement) {
    case "left":
      dock.addPanel({ ...base, position: { direction: "left" }, initialWidth: pinned.left ?? sizes.left });
      break;
    case "right":
      dock.addPanel({ ...base, position: { direction: "right" }, initialWidth: pinned.right ?? sizes.right });
      break;
    case "bottom":
      dock.addPanel({
        ...base,
        position: center ? { referencePanel: center.id, direction: "below" } : { direction: "below" },
        initialHeight: pinned.bottom ?? sizes.bottom,
      });
      break;
    default:
      dock.addPanel(center ? { ...base, position: { referencePanel: center.id, direction: "within" } } : base);
  }
}

/** Lay out exactly `ids` (by placement), closing everything else. */
function build(ids: string[]) {
  if (!dock) return;
  dock.clear();
  const panels = [...useRegistry.getState().panels]
    .filter((p) => ids.includes(p.id))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  // Center first so side panels can be placed relative to it.
  for (const placement of ["center", "left", "right", "bottom"] as const) {
    panels.filter((p) => (p.placement ?? "center") === placement).forEach((p, i) => addPanel(p, i > 0));
  }
  const firstCenter = panels.find((p) => (p.placement ?? "center") === "center");
  if (firstCenter) dock.getPanel(firstCenter.id)?.api.setActive();
  syncOpen();
  // initialWidth/Height are ignored while the dock has no size; apply them once it does.
  if (!dock.width) {
    const d = defaultSizes();
    pendingSizes = { left: pinned.left ?? d.left, right: pinned.right ?? d.right, bottom: pinned.bottom ?? d.bottom };
  }
}

/** Called on every layout change: flush sizes deferred while the dock was hidden. */
function flushPendingSizes() {
  if (!pendingSizes || !dock?.width) return;
  pendingSizes = null;
  // Recompute relative defaults now that the real size is known, unless the user had sizes.
  const d = defaultSizes();
  pinned = { left: pinned.left ?? d.left, right: pinned.right ?? d.right, bottom: pinned.bottom ?? d.bottom };
  resizingUntil = Date.now() + 250;
  applyPinnedSizes();
}

const defaultPanels = () => useRegistry.getState().panels.filter((p) => p.defaultOpen).map((p) => p.id);

export const layout = {
  init(api: DockviewApi) {
    dock = api;
    api.onDidAddPanel(syncOpen);
    api.onDidRemovePanel(syncOpen);
    api.onDidLayoutChange(() => {
      flushPendingSizes();
      rememberSizes();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => writeJson(LAYOUT_KEY, api.toJSON()), 300);
    });
    window.addEventListener("resize", () => {
      // dockview distributes the change proportionally; restore the side sizes afterwards.
      resizingUntil = Date.now() + 250;
      setTimeout(applyPinnedSizes, 60);
    });

    let restored = false;
    const saved = readJson<SerializedDockview>(LAYOUT_KEY);
    if (saved) {
      try {
        api.fromJSON(saved);
        restored = api.panels.length > 0;
      } catch (err) {
        console.warn("[layout] could not restore saved layout", err);
      }
    }
    if (restored) {
      resizingUntil = Date.now() + 250;
      setTimeout(applyPinnedSizes, 0);
    } else {
      build(defaultPanels());
    }
    syncOpen();
  },

  open(id: string) {
    if (!dock) return;
    const existing = dock.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const c = registry.panel(id);
    if (c) addPanel(c);
  },

  close(id: string) {
    dock?.getPanel(id)?.api.close();
  },

  toggle(id: string) {
    const p = dock?.getPanel(id);
    // Toggling a panel hidden behind another tab brings it forward rather than closing it.
    if (p && p.api.isVisible) layout.close(id);
    else layout.open(id);
  },

  reset() {
    localStorage.removeItem(LAYOUT_KEY);
    pinned = {};
    writeJson(PINNED_KEY, pinned);
    build(defaultPanels());
    // Apply the relative defaults explicitly; dockview's initial sizes get rebalanced otherwise.
    const d = defaultSizes();
    pinned = d;
    resizingUntil = Date.now() + 250;
    if (dock?.width) applyPinnedSizes();
    else pendingSizes = d;
  },

  // ---- presets ----

  listPresets() {
    const { presets, saved } = useLayout.getState();
    return [
      { id: "default", name: "Default", description: "The standard layout", panels: defaultPanels() },
      ...presets,
      ...saved.map((s) => ({ id: s.id, name: s.name, description: "Saved layout", panels: [] as string[], saved: true })),
    ];
  },

  registerPreset(preset: LayoutPreset) {
    useLayout.setState((s) => ({ presets: [...s.presets.filter((p) => p.id !== preset.id), preset] }));
    return toDisposable(() => useLayout.setState((s) => ({ presets: s.presets.filter((p) => p !== preset) })));
  },

  applyPreset(id: string) {
    if (!dock) return;
    if (id === "default") return layout.reset();
    const saved = useLayout.getState().saved.find((s) => s.id === id);
    if (saved) {
      try {
        dock.fromJSON(saved.json);
        pinned = { ...saved.pinned };
        writeJson(PINNED_KEY, pinned);
        resizingUntil = Date.now() + 250;
        setTimeout(applyPinnedSizes, 0);
        syncOpen();
      } catch (err) {
        console.warn("[layout] saved layout is invalid", err);
      }
      return;
    }
    const preset = useLayout.getState().presets.find((p) => p.id === id);
    if (preset) build(preset.panels);
  },

  saveCurrent(name: string) {
    if (!dock) return;
    rememberSizes();
    const entry: SavedLayout = { id: `saved:${name}`, name, json: dock.toJSON(), pinned: { ...pinned } };
    const saved = [...useLayout.getState().saved.filter((s) => s.id !== entry.id), entry];
    useLayout.setState({ saved });
    writeJson(SAVED_KEY, saved);
  },

  deleteSaved(id: string) {
    const saved = useLayout.getState().saved.filter((s) => s.id !== id);
    useLayout.setState({ saved });
    writeJson(SAVED_KEY, saved);
  },
};
