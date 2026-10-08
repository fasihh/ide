import type { Language } from "./domain.ts";

/** Something the user can do about an unavailable server: a command registered by the server's plugin. */
export type LanguageServerAction = { label: string; command: string };

/** Whether a language server can be started right now, as reported by its plugin. */
export type LanguageServerAvailability =
  | { available: true; initializationOptions?: unknown; configuration?: Record<string, unknown> }
  | { available: false; error: string; hint?: string; action?: LanguageServerAction };

/** A registered language server (`GET /api/lsp/servers`). */
export type LanguageServerInfo = { id: string; name: string; languages: Language[] } & LanguageServerAvailability;
