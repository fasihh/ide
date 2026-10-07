import fs from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { ZodError } from "zod";
import { createApi } from "./app.ts";
import { HttpError } from "./errors.ts";
import { WEB_DIST } from "./paths.ts";
import { ServerPluginHost } from "./plugin-host.ts";
import { createServices } from "./services/index.ts";

const PORT = Number(process.env.PORT ?? 7420);

// An explicit data folder that doesn't exist is almost certainly a mistake (e.g. a deleted test
// folder); refuse to start rather than silently falling back to defaults and the real ~/cp.
if (process.env.CP_IDE_HOME && !fs.existsSync(process.env.CP_IDE_HOME)) {
  console.error(`CP_IDE_HOME=${process.env.CP_IDE_HOME} does not exist. Create it or unset CP_IDE_HOME.`);
  process.exit(1);
}

const services = await createServices();
const host = new ServerPluginHost(services);
const api = createApi(services, () => host.infos);
await host.load(api);

const app = new Hono();
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
  console.error(err);
  return c.json({ error: err.message || "Internal error" }, 500);
});
app.route("/api", api);

// Serve the built web app when it exists (`pnpm start`); in dev, Vite serves it.
if (fs.existsSync(WEB_DIST)) {
  const root = WEB_DIST.replace(/\\/g, "/");
  app.use("/*", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, (info) => {
  console.log(`cp-ide server on http://localhost:${info.port}`);
  console.log(`problems root: ${services.problems.root()}`);
});
