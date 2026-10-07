/**
 * Public types of the palette plugin. Other plugins add their own palette modes through the
 * "palette" service:
 *
 *   import type { PaletteService } from "@cp-ide/plugin-palette";
 *   ctx.services.get<PaletteService>("palette")?.registerProvider({ id: "my", prefix: "@", ... });
 */
import type { Disposable, IconComponent } from "@cp-ide/plugin-api/web";

export interface PaletteControl {
  /** Replace the palette's text (e.g. switch to another mode by setting its prefix). */
  setQuery(query: string): void;
  close(): void;
}

export interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  /** Second line under the label. */
  detail?: string;
  /** Right-aligned hint, e.g. a keybinding or state. */
  hint?: string;
  icon?: IconComponent;
  /** Extra text that is matched but not displayed. */
  keywords?: string;
  /** Called on Enter/click. The palette closes afterwards unless `keepOpen` is set. */
  run(palette: PaletteControl): unknown;
  keepOpen?: boolean;
}

export interface PaletteProvider {
  id: string;
  /** Typed first to enter this mode (">", "#", ...). Providers with "" show in the default mode. */
  prefix: string;
  /** Section title in the results, and the mode's name in help. */
  title: string;
  placeholder?: string;
  /** Items for the query (prefix already stripped). */
  provide(query: string): PaletteItem[] | Promise<PaletteItem[]>;
  /** Fuzzy-filter and rank the returned items by the query (default true). */
  filter?: boolean;
  /** Section order in the default mode (lower first). */
  order?: number;
  /** Max items shown (default 50, 8 per section in the default mode with an empty query). */
  limit?: number;
}

export interface PaletteService {
  registerProvider(provider: PaletteProvider): Disposable;
  /** Open the palette with `query` (e.g. ">" for commands). */
  open(query?: string): void;
  close(): void;
}
