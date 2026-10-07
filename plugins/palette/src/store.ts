import { create } from "zustand";
import type { PaletteProvider } from "./types.ts";

export const usePalette = create<{ open: boolean; query: string; providers: PaletteProvider[] }>(() => ({
  open: false,
  query: "",
  providers: [],
}));

export const openPalette = (query = "") => usePalette.setState({ open: true, query });
export const closePalette = () => usePalette.setState({ open: false });

export function addProvider(p: PaletteProvider) {
  usePalette.setState((s) => ({ providers: [...s.providers.filter((x) => x.id !== p.id), p] }));
  return { dispose: () => usePalette.setState((s) => ({ providers: s.providers.filter((x) => x !== p) })) };
}

/** The providers for a query: the mode whose prefix the query starts with (longest wins), else the default mode. */
export function resolveMode(query: string, providers: PaletteProvider[]) {
  const prefixed = providers.filter((p) => p.prefix && query.startsWith(p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length);
  const prefix = prefixed[0]?.prefix ?? "";
  const active = providers.filter((p) => p.prefix === prefix).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return { prefix, active, text: query.slice(prefix.length).trimStart() };
}
