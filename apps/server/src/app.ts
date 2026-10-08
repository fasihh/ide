import { Hono } from "hono";
import { eventsRoute, libraryRoutes, lspRoutes, problemsRoutes, runRoutes, settingsRoutes } from "./routes/index.ts";
import type { Services } from "./services/index.ts";
import type { ServerPluginInfo } from "./plugin-host.ts";

/**
 * Core API, mounted at `/api`. Its type (`AppType`) is what the web app's `hc` client
 * is generated from, so every route here is type checked end to end.
 *
 * Plugin routes are mounted on the same instance at `/api/plugins/<id>` but are typed
 * separately (see `PluginRoutes` in @cp-ide/plugin-api).
 */
export function createApi(s: Services, plugins: () => ServerPluginInfo[]) {
  return new Hono()
    .get("/health", (c) => c.json({ ok: true as const, platform: process.platform }))
    .get("/plugins", (c) => c.json(plugins()))
    .route("/settings", settingsRoutes(s))
    .route("/problems", problemsRoutes(s))
    .route("/run", runRoutes(s))
    .route("/library", libraryRoutes(s))
    .route("/events", eventsRoute(s))
    .route("/lsp", lspRoutes(s));
}

export type AppType = ReturnType<typeof createApi>;
