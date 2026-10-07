import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { type ProcessSession, defineServerPlugin } from "@cp-ide/plugin-api/server";
import { libraryNameSchema } from "@cp-ide/shared";
import { type ClientMessage, type ServerMessage, playgroundSettings } from "./shared.ts";

/** First file in an empty playground: shows off typing input while the program runs. */
const STARTERS: Record<"cpp" | "python", string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    string name;
    cout << "What's your name? ";
    cin >> name;
    cout << "Hello, " << name << "!" << endl;
}
`,
  python: `name = input("What's your name? ")
print(f"Hello, {name}!")
`,
};

const languageOf = (name: string) => (name.endsWith(".py") ? ("python" as const) : ("cpp" as const));

const plugin = defineServerPlugin({
  id: "playground",
  name: "Playground",
  description: "Playground files and terminal runs.",
  settings: playgroundSettings,

  routes: (ctx) => {
    const dir = async () => {
      const configured = String(ctx.settings.getRaw("playground.folder") ?? "").trim();
      const d = configured ? path.resolve(configured.replace(/^~(?=$|[\\/])/, os.homedir())) : ctx.dataDir;
      await fs.mkdir(d, { recursive: true });
      return d;
    };
    const file = async (name: string) => path.join(await dir(), libraryNameSchema.parse(name));
    const list = async () => {
      const d = await dir();
      let names = (await fs.readdir(d)).filter((n) => libraryNameSchema.safeParse(n).success);
      if (!names.length) {
        await fs.writeFile(path.join(d, "main.cpp"), STARTERS.cpp);
        names = ["main.cpp"];
      }
      names.sort();
      return {
        folder: d,
        files: await Promise.all(names.map(async (name) => ({ name, language: languageOf(name), content: await fs.readFile(path.join(d, name), "utf8") }))),
      };
    };
    const name = z.object({ name: libraryNameSchema });

    return new Hono()
      .get("/files", async (c) => c.json(await list()))
      .put("/file", zValidator("json", name.extend({ content: z.string() })), async (c) => {
        const { name, content } = c.req.valid("json");
        await fs.writeFile(await file(name), content);
        return c.json({ ok: true as const });
      })
      .post("/create", zValidator("json", name.extend({ content: z.string().optional() })), async (c) => {
        const { name, content } = c.req.valid("json");
        try {
          await fs.writeFile(await file(name), content ?? STARTERS[languageOf(name)], { flag: "wx" });
        } catch (err: any) {
          if (err.code === "EEXIST") return c.json({ error: `${name} already exists` }, 409);
          throw err;
        }
        return c.json(await list());
      })
      .post("/rename", zValidator("json", z.object({ from: libraryNameSchema, to: libraryNameSchema })), async (c) => {
        const { from, to } = c.req.valid("json");
        const dst = await file(to);
        if (await fs.access(dst).then(() => true, () => false)) return c.json({ error: `${to} already exists` }, 409);
        await fs.rename(await file(from), dst);
        return c.json(await list());
      })
      .post("/delete", zValidator("json", name), async (c) => {
        await fs.rm(await file(c.req.valid("json").name), { force: true });
        return c.json(await list());
      });
  },

  setup(ctx) {
    // One socket per terminal. A "start" compiles (cached) and runs; stdin/eof/kill drive the process.
    return ctx.websocket("run", (socket) => {
      let session: ProcessSession | null = null;
      let runId = 0;
      const send = (m: ServerMessage) => socket.send(JSON.stringify(m));

      socket.onMessage(async (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw);
        } catch {
          return send({ type: "error", message: "Bad message" });
        }
        if (msg.type === "start") {
          session?.kill();
          session = null;
          const id = ++runId;
          send({ type: "compiling" });
          const compiled = await ctx.runner.compile({ language: msg.language, source: msg.source, fileName: msg.fileName });
          if (id !== runId) return;
          send({ type: "compiled", ok: compiled.ok, stderr: compiled.stderr, timeMs: compiled.timeMs, cached: compiled.ok && compiled.cached });
          if (!compiled.ok) return;
          const maxRunSeconds = Number(ctx.settings.getRaw("playground.maxRunSeconds") ?? 300);
          const s = ctx.runner.start(compiled.artifactId, { maxRunMs: maxRunSeconds > 0 ? maxRunSeconds * 1000 : 0 });
          if (!s) return send({ type: "error", message: "Could not start the program — try running again" });
          session = s;
          s.onStdout((data) => id === runId && send({ type: "stdout", data }));
          s.onStderr((data) => id === runId && send({ type: "stderr", data }));
          s.onExit((info) => {
            if (id !== runId) return;
            session = null;
            send({ type: "exit", ...info });
          });
          send({ type: "started" });
        } else if (msg.type === "stdin") session?.write(msg.data);
        else if (msg.type === "eof") session?.end();
        else if (msg.type === "kill") session?.kill();
      });
      socket.onClose(() => {
        runId++;
        session?.kill();
      });
    });
  },
});

export default plugin;
