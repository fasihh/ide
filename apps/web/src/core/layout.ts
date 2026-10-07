import { create } from "zustand";
import type { DockviewApi } from "dockview-react";
import type { PanelContribution } from "@cp-ide/plugin-api/web";
import { registry, useRegistry } from "./registry.ts";

const LAYOUT_KEY = "cp-ide.layout.v1";
/** Every plugin panel is rendered through this one dockview component; params carry the panel id. */
export const PANEL_COMPONENT = "plugin-panel";

const clamp = (min: number, v: number, max: number) => Math.round(Math.min(max, Math.max(min, v)));
/** Default side sizes, relative to the window so the editor keeps most of the space. */
function sizes() {
  const w = dock?.width || window.innerWidth;
  const h = dock?.height || window.innerHeight;
  return { left: clamp(200, w * 0.17, 300), right: clamp(340, w * 0.32, 620), bottom: clamp(120, h * 0.22, 260) };
}

export const useLayout = create<{ open: string[] }>(() => ({ open: [] }));

let dock: DockviewApi | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function syncOpen() {
  if (dock) useLayout.setState({ open: dock.panels.map((p) => p.id) });
}

function sortedPanels(): PanelContribution[] {
  return [...useRegistry.getState().panels].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** An open panel that shares `placement`, used to dock new panels into the same group. */
function openSibling(placement: PanelContribution["placement"], exclude?: string) {
  if (!dock) return undefined;
  return dock.panels.find((p) => p.id !== exclude && (registry.panel(p.id)?.placement ?? "center") === placement);
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
  const SIZES = sizes();
  switch (placement) {
    case "left":
      dock.addPanel({ ...base, position: { direction: "left" }, initialWidth: SIZES.left });
      break;
    case "right":
      dock.addPanel({ ...base, position: { direction: "right" }, initialWidth: SIZES.right });
      break;
    case "bottom":
      dock.addPanel({
        ...base,
        position: center ? { referencePanel: center.id, direction: "below" } : { direction: "below" },
        initialHeight: SIZES.bottom,
      });
      break;
    default:
      dock.addPanel(center ? { ...base, position: { referencePanel: center.id, direction: "within" } } : base);
  }
}

function buildDefault() {
  if (!dock) return;
  dock.clear();
  const panels = sortedPanels().filter((p) => p.defaultOpen);
  // Center first so side panels can be placed relative to it.
  const order = ["center", "left", "right", "bottom"] as const;
  for (const placement of order) {
    panels.filter((p) => (p.placement ?? "center") === placement).forEach((p, i) => addPanel(p, i > 0));
  }
  const firstCenter = panels.find((p) => (p.placement ?? "center") === "center");
  if (firstCenter) dock.getPanel(firstCenter.id)?.api.setActive();
}

export const layout = {
  init(api: DockviewApi) {
    dock = api;
    api.onDidAddPanel(syncOpen);
    api.onDidRemovePanel(syncOpen);
    api.onDidLayoutChange(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(api.toJSON()));
        } catch {}
      }, 300);
    });

    let restored = false;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        api.fromJSON(JSON.parse(raw));
        restored = api.panels.length > 0;
      }
    } catch (err) {
      console.warn("[layout] could not restore saved layout", err);
    }
    if (!restored) buildDefault();
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
    buildDefault();
    syncOpen();
  },
};
