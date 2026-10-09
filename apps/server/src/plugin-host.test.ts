/**
 * Turning plugins off and on while the server runs, with the real plugins in `plugins/`.
 * Uses a throwaway CP_IDE_HOME so nothing touches ~/.cp-ide.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "cp-ide-plugins-test-"));
process.env.CP_IDE_HOME = home;
await fs.writeFile(path.join(home, "settings.json"), JSON.stringify({ "problems.root": path.join(home, "cp").replace(/\\/g, "/") }));

const { createServices } = await import("./services/index.ts");
const { SocketRouter } = await import("./sockets.ts");
const { ServerPluginHost } = await import("./plugin-host.ts");

const services = await createServices();
const host = new ServerPluginHost(services, new SocketRouter());
const api = new Hono();
await host.load(api);
// Mounted like apps/server/src/index.ts does.
const app = new Hono().route("/api", api);

after(async () => {
  host.dispose();
  services.watcher.close();
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

const get = (url: string) => app.request(`/api${url}`);
/** Change the setting the way the UI does and wait for the host to catch up. */
async function disable(ids: string[]) {
  const changed = new Promise<void>((resolve) => {
    const sub = services.events.on("plugins:changed", () => {
      sub.dispose();
      resolve();
    });
  });
  await services.settings.update({ "plugins.disabled": ids });
  await changed;
}

test("routes follow the plugin's state without a restart", async () => {
  assert.equal((await get("/plugins/playground/files")).status, 200);

  await disable(["playground"]);
  const off = await get("/plugins/playground/files");
  assert.equal(off.status, 404);
  assert.deepEqual(await off.json(), { error: 'The "playground" plugin is turned off' }, "JSON, not the web app's HTML");
  assert.equal(host.infos.find((i) => i.id === "playground")?.enabled, false);

  await disable([]);
  assert.equal((await get("/plugins/playground/files")).status, 200, "turned back on");
  assert.equal((await get("/plugins/nope/x")).status, 404);
});

test("turning a language server plugin off unregisters its server", async () => {
  const ids = async () => (await services.languageServers.list()).map((s) => s.id);
  assert.ok((await ids()).includes("basedpyright"));
  await disable(["lsp-basedpyright"]);
  assert.ok(!(await ids()).includes("basedpyright"));
  await disable([]);
  assert.ok((await ids()).includes("basedpyright"));
});
