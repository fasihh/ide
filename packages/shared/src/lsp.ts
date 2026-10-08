import type { Language } from "./domain.ts";

/** Whether a language server can be started right now, as reported by its plugin. */
export type LanguageServerAvailability =
  | { available: true; initializationOptions?: unknown; configuration?: Record<string, unknown> }
  | { available: false; error: string; hint?: string };

/** A registered language server (`GET /api/lsp/servers`). */
export type LanguageServerInfo = { id: string; name: string; languages: Language[] } & LanguageServerAvailability;
