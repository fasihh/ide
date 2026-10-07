import { create } from "zustand";
import { getSetting, useSettings } from "./settings.ts";

const media = window.matchMedia("(prefers-color-scheme: dark)");

export const useTheme = create<{ resolved: "dark" | "light" }>(() => ({ resolved: "dark" }));

function apply() {
  const pref = getSetting("appearance.theme");
  const resolved = pref === "system" ? (media.matches ? "dark" : "light") : pref === "light" ? "light" : "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  // The UI is sized in rem with regular text at 0.75rem, so scale the root font size such that
  // regular text equals the setting; spacing and controls scale along with it.
  root.style.fontSize = `${(getSetting("appearance.uiFontSize") * 16) / 12}px`;
  root.style.setProperty("--editor-font", getSetting("editor.fontFamily"));
  if (useTheme.getState().resolved !== resolved) useTheme.setState({ resolved });
}

/** Keep <html> classes/variables in sync with appearance settings. */
export function installTheme() {
  apply();
  useSettings.subscribe(apply);
  media.addEventListener("change", apply);
}

export const themeApi = {
  get: () => useTheme.getState().resolved,
  use: () => useTheme((s) => s.resolved),
};
