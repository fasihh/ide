import { Hono } from "hono";
import { zValidator as zv } from "@hono/zod-validator";
import { z } from "zod";
import {
  compileRequestSchema,
  createProblemSchema,
  execRequestSchema,
  languageSchema,
  problemMetaPatchSchema,
  testCaseSchema,
} from "@cp-ide/shared";
import type { Services } from "../services/index.ts";

/** zValidator that reports failures as `{ error: string }` like every other API error. */
const zValidator = <T extends z.ZodType, Target extends "json" | "query">(target: Target, schema: T) =>
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
    .put("/tests", zValidator("json", idQuery.extend({ tests: z.array(testCaseSchema) })), async (c) => {
      const { id, tests } = c.req.valid("json");
      await s.problems.writeTests(id, tests);
      return c.json({ ok: true as const });
    });

export const runRoutes = (s: Services) =>
  new Hono()
    .post("/compile", zValidator("json", compileRequestSchema), async (c) => c.json(await s.runner.compile(c.req.valid("json"))))
    .post("/exec", zValidator("json", execRequestSchema), async (c) => c.json(await s.runner.exec(c.req.valid("json"))));
