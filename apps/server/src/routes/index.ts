import { Hono } from "hono";
import { zValidator as zv } from "@hono/zod-validator";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import {
  type ServerEvent,
  compileRequestSchema,
  libraryKindSchema,
  libraryNameSchema,
  createProblemSchema,
  execRequestSchema,
  interactRequestSchema,
  languageSchema,
  problemMetaPatchSchema,
  testCaseSchema,
} from "@cp-ide/shared";
import type { Services } from "../services/index.ts";

/** zValidator that reports failures as `{ error: string }` like every other API error. */
const zValidator = <T extends z.ZodType, Target extends "json" | "query" | "param">(target: Target, schema: T) =>
  zv(target, schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: result.error.issues.map((i) => `${i.path.join(".") || target}: ${i.message}`).join("; ") }, 400);
    }
  });

const idQuery = z.object({ id: z.string().min(1) });

export const settingsRoutes = (s: Services) =>
  new Hono()
    .get("/", (c) => c.json({ values: s.settings.all(), overrides: s.settings.getOverrides() }))
    .patch("/", zValidator("json", z.record(z.string(), z.unknown())), async (c) => {
      await s.settings.update(c.req.valid("json"));
      return c.json({ values: s.settings.all(), overrides: s.settings.getOverrides() });
    });

export const problemsRoutes = (s: Services) =>
  new Hono()
    .get("/", async (c) => c.json({ root: s.problems.root(), problems: await s.problems.list() }))
    .get("/detail", zValidator("query", idQuery), async (c) => c.json(await s.problems.get(c.req.valid("query").id)))
    .post("/", zValidator("json", createProblemSchema), async (c) => c.json(await s.problems.create(c.req.valid("json"))))
    .post("/scratch", zValidator("json", z.object({ language: languageSchema.optional() })), async (c) =>
      c.json(await s.problems.createScratch(c.req.valid("json").language)),
    )
    .patch("/meta", zValidator("json", idQuery.extend({ patch: problemMetaPatchSchema })), async (c) => {
      const { id, patch } = c.req.valid("json");
      return c.json(await s.problems.updateMeta(id, patch));
    })
    .put("/file", zValidator("json", idQuery.extend({ file: z.string(), content: z.string() })), async (c) => {
      const { id, file, content } = c.req.valid("json");
      await s.problems.writeFile(id, file, content);
      return c.json({ ok: true as const });
    })
    .post("/file/create", zValidator("json", idQuery.extend({ file: z.string(), content: z.string().optional() })), async (c) => {
      const { id, file, content } = c.req.valid("json");
      await s.problems.createFile(id, file, content);
      return c.json(await s.problems.get(id));
    })
    .post("/file/delete", zValidator("json", idQuery.extend({ file: z.string() })), async (c) => {
      const { id, file } = c.req.valid("json");
      await s.problems.deleteFile(id, file);
      return c.json(await s.problems.get(id));
    })
    .post("/file/rename", zValidator("json", idQuery.extend({ from: z.string(), to: z.string() })), async (c) => {
      const { id, from, to } = c.req.valid("json");
      await s.problems.renameFile(id, from, to);
      return c.json(await s.problems.get(id));
    })
    .post(
      "/move",
      zValidator("json", idQuery.extend({ name: z.string().optional(), platform: z.string().optional(), group: z.string().optional() })),
      async (c) => {
        const { id, ...target } = c.req.valid("json");
        return c.json(await s.problems.move(id, target));
      },
    )
    .post("/trash", zValidator("json", idQuery), async (c) => c.json({ trashId: await s.problems.trash(c.req.valid("json").id) }))
    .post("/restore", zValidator("json", z.object({ trashId: z.string().min(1) })), async (c) =>
      c.json(await s.problems.restore(c.req.valid("json").trashId)),
    )
    .put("/tests", zValidator("json", idQuery.extend({ tests: z.array(testCaseSchema) })), async (c) => {
      const { id, tests } = c.req.valid("json");
      await s.problems.writeTests(id, tests);
      return c.json({ ok: true as const });
    });

export const runRoutes = (s: Services) =>
  new Hono()
    .post("/compile", zValidator("json", compileRequestSchema), async (c) => c.json(await s.runner.compile(c.req.valid("json"))))
    .post("/exec", zValidator("json", execRequestSchema), async (c) => c.json(await s.runner.exec(c.req.valid("json"))))
    .post("/interact", zValidator("json", interactRequestSchema), async (c) => c.json(await s.runner.interact(c.req.valid("json"))));

const kindParam = z.object({ kind: libraryKindSchema });

export const libraryRoutes = (s: Services) =>
  new Hono()
    .get("/:kind", zValidator("param", kindParam), async (c) => c.json(await s.library.list(c.req.valid("param").kind)))
    .put("/:kind", zValidator("param", kindParam), zValidator("json", z.object({ name: libraryNameSchema, content: z.string() })), async (c) => {
      const { name, content } = c.req.valid("json");
      await s.library.save(c.req.valid("param").kind, name, content);
      return c.json({ ok: true as const });
    })
    .post(
      "/:kind/create",
      zValidator("param", kindParam),
      zValidator("json", z.object({ name: libraryNameSchema, content: z.string().optional() })),
      async (c) => {
        const { name, content } = c.req.valid("json");
        await s.library.create(c.req.valid("param").kind, name, content);
        return c.json(await s.library.list(c.req.valid("param").kind));
      },
    )
    .post("/:kind/rename", zValidator("param", kindParam), zValidator("json", z.object({ from: libraryNameSchema, to: libraryNameSchema })), async (c) => {
      const { from, to } = c.req.valid("json");
      await s.library.rename(c.req.valid("param").kind, from, to);
      return c.json(await s.library.list(c.req.valid("param").kind));
    })
    .post("/:kind/delete", zValidator("param", kindParam), zValidator("json", z.object({ name: libraryNameSchema })), async (c) => {
      await s.library.remove(c.req.valid("param").kind, c.req.valid("json").name);
      return c.json(await s.library.list(c.req.valid("param").kind));
    });

/** Server-sent events (`ServerEvent` JSON in `data`). Not part of the RPC types: use EventSource. */
export const eventsRoute = (s: Services) =>
  new Hono().get("/", (c) =>
    streamSSE(c, async (stream) => {
      const send = (e: ServerEvent) => void stream.writeSSE({ data: JSON.stringify(e) });
      const sub = s.events.on("problems:changed", ({ ids }) => send({ type: "problems-changed", ids }));
      stream.onAbort(() => sub.dispose());
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(20_000);
      }
      sub.dispose();
    }),
  );
