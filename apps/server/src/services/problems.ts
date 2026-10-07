import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type CreateProblemInput,
  type Language,
  type Problem,
  type ProblemMeta,
  type ProblemMetaPatch,
  type ProblemSummary,
  type TestCase,
  LANGUAGE_INFO,
  createProblemSchema,
  problemMetaSchema,
  testCaseSchema,
} from "@cp-ide/shared";
import type { ProblemsService as ProblemsApi } from "@cp-ide/plugin-api/server";
import { expandHome, resolveInside } from "../paths.ts";
import { HttpError } from "../errors.ts";
import { writeFileAtomic } from "../fs-utils.ts";
import type { LibraryService } from "./library.ts";
import type { SettingsService } from "./settings.ts";

const META_FILE = "problem.json";
const TESTS_FILE = "tests.json";
const TRASH_DIR = ".trash";
const TRASH_MARKER = ".cp-ide-trash.json";
const SOURCE_EXTS = new Set([".cpp", ".cc", ".cxx", ".h", ".hpp", ".py", ".txt", ".in", ".out", ".ans", ".md"]);
const MAX_SCAN_DEPTH = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

const now = () => new Date().toISOString();

export class ProblemsService implements ProblemsApi {
  constructor(
    private settings: SettingsService,
    private library: LibraryService,
    private onCreated: (p: Problem) => void = () => {},
  ) {}

  root(): string {
    return path.resolve(expandHome(this.settings.get("problems.root")));
  }

  dir(id: string): string {
    return resolveInside(this.root(), id);
  }

  async list(): Promise<ProblemSummary[]> {
    const root = this.root();
    await fs.mkdir(root, { recursive: true });
    const out: ProblemSummary[] = [];

    const walk = async (dir: string, depth: number) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some((e) => e.isFile() && e.name === META_FILE)) {
        const meta = await this.readMeta(dir).catch(() => null);
        if (meta) out.push({ ...meta, id: path.relative(root, dir).split(path.sep).join("/") });
        return;
      }
      if (depth >= MAX_SCAN_DEPTH) return;
      await Promise.all(
        entries
          .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
          .map((e) => walk(path.join(dir, e.name), depth + 1)),
      );
    };

    await walk(root, 0);
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Problem> {
    const dir = this.dir(id);
    const meta = await this.readMeta(dir).catch((err) => {
      throw new HttpError(404, `Problem not found: ${id} (${err.message})`);
    });
    const tests = await this.readTests(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && SOURCE_EXTS.has(path.extname(e.name).toLowerCase()))
        .map(async (e) => {
          const p = path.join(dir, e.name);
          const stat = await fs.stat(p);
          const content =
            stat.size > MAX_FILE_BYTES ? `// file too large to open (${stat.size} bytes)` : await fs.readFile(p, "utf8");
          return { name: e.name, content };
        }),
    );
    files.sort((a, b) => (a.name === meta.mainFile ? -1 : b.name === meta.mainFile ? 1 : a.name.localeCompare(b.name)));
    return { id, meta, tests, files };
  }

  async create(raw: CreateProblemInput): Promise<Problem> {
    const input = createProblemSchema.parse(raw);
    const language = input.language ?? this.settings.get("problems.defaultLanguage");
    const root = this.root();

    const base = path.join(root, slugify(input.platform), slugify(input.group), slugify(input.name));
    let dir = base;
    for (let i = 2; await exists(dir); i++) dir = `${base}-${i}`;
    await fs.mkdir(dir, { recursive: true });

    const mainFile = `main.${LANGUAGE_INFO[language].ext}`;
    const meta: ProblemMeta = {
      name: input.name,
      platform: input.platform,
      group: input.group,
      url: input.url,
      language,
      mainFile,
      timeLimitMs: input.timeLimitMs,
      memoryLimitMb: input.memoryLimitMb,
      status: "todo",
      tags: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const tests: TestCase[] = (input.tests ?? []).map((t) => ({
      id: randomUUID(),
      input: t.input,
      expected: t.expected,
      isSample: true,
      enabled: true,
    }));

    await fs.writeFile(path.join(dir, mainFile), await this.template(language, input.template));
    await writeJson(path.join(dir, META_FILE), meta);
    await writeJson(path.join(dir, TESTS_FILE), tests);

    const problem = await this.get(path.relative(root, dir).split(path.sep).join("/"));
    this.onCreated(problem);
    return problem;
  }

  createScratch(language?: Language): Promise<Problem> {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return this.create({
      name: `scratch ${time}`,
      platform: "scratch",
      group: day,
      language,
      tests: [{ input: "", expected: "" }],
    });
  }

  async updateMeta(id: string, patch: ProblemMetaPatch): Promise<ProblemMeta> {
    const dir = this.dir(id);
    const meta = await this.readMeta(dir);
    const next: ProblemMeta = problemMetaSchema.parse({ ...meta, ...patch, updatedAt: now() });
    if (patch.language && patch.language !== meta.language) {
      // Switching language: point at main.<ext>, creating it from the template if needed.
      next.mainFile = `main.${LANGUAGE_INFO[patch.language].ext}`;
      const p = path.join(dir, next.mainFile);
      if (!(await exists(p))) await fs.writeFile(p, await this.template(patch.language));
    }
    await writeJson(path.join(dir, META_FILE), next);
    return next;
  }

  async writeFile(id: string, file: string, content: string): Promise<void> {
    this.checkFileName(file);
    const dir = this.dir(id);
    await fs.writeFile(path.join(dir, file), content);
    await this.touch(dir);
  }

  /** Create a new file; source files start from the language template unless `content` is given. */
  async createFile(id: string, file: string, content?: string): Promise<void> {
    const p = path.join(this.dir(id), this.checkFileName(file));
    if (await exists(p)) throw new HttpError(409, `${file} already exists`);
    const ext = path.extname(file).toLowerCase();
    const language: Language | null = [".cpp", ".cc", ".cxx"].includes(ext) ? "cpp" : ext === ".py" ? "python" : null;
    await fs.writeFile(p, content ?? (language ? await this.template(language) : ""));
    await this.touch(this.dir(id));
  }

  async deleteFile(id: string, file: string): Promise<void> {
    const dir = this.dir(id);
    const meta = await this.readMeta(dir);
    if (file === meta.mainFile) throw new HttpError(400, "The main file cannot be deleted");
    await fs.rm(path.join(dir, this.checkFileName(file)));
    await this.touch(dir);
  }

  /** Rename a file; renaming the main file updates `mainFile` (and the language, by extension). */
  async renameFile(id: string, from: string, to: string): Promise<void> {
    const dir = this.dir(id);
    const src = path.join(dir, this.checkFileName(from));
    const dst = path.join(dir, this.checkFileName(to));
    if (await exists(dst)) throw new HttpError(409, `${to} already exists`);
    await fs.rename(src, dst);
    const meta = await this.readMeta(dir);
    if (meta.mainFile === from) {
      const ext = path.extname(to).toLowerCase();
      const language: Language | null = [".cpp", ".cc", ".cxx"].includes(ext) ? "cpp" : ext === ".py" ? "python" : null;
      if (!language) {
        await fs.rename(dst, src);
        throw new HttpError(400, "The main file must stay a .cpp or .py file");
      }
      await writeJson(path.join(dir, META_FILE), { ...meta, mainFile: to, language, updatedAt: now() });
    } else {
      await this.touch(dir);
    }
  }

  private checkFileName(file: string): string {
    if (!file || file !== path.basename(file) || !SOURCE_EXTS.has(path.extname(file).toLowerCase())) {
      throw new HttpError(400, `Not an editable file name: ${file} (allowed: ${[...SOURCE_EXTS].join(" ")})`);
    }
    return file;
  }

  /**
   * Rename and/or move a problem. The folder follows `platform/group/name` (slugified); returns the
   * problem under its new id.
   */
  async move(id: string, target: { name?: string; platform?: string; group?: string }): Promise<Problem> {
    const root = this.root();
    const dir = this.dir(id);
    const meta = await this.readMeta(dir);
    const next = { ...meta, ...Object.fromEntries(Object.entries(target).filter(([, v]) => v?.trim())), updatedAt: now() };
    const newId = [slugify(next.platform), slugify(next.group), slugify(next.name)].join("/");
    let newDir = dir;
    if (newId !== id) {
      newDir = this.dir(newId);
      if (await exists(newDir)) throw new HttpError(409, `A problem already exists at ${newId}`);
      await fs.mkdir(path.dirname(newDir), { recursive: true });
      await renameDir(dir, newDir);
      await removeEmptyParents(path.dirname(dir), root);
    }
    await writeJson(path.join(newDir, META_FILE), next);
    return this.get(newId === id ? id : newId);
  }

  /** Move a problem to `<root>/.trash` (restorable). Returns the trash entry id. */
  async trash(id: string): Promise<string> {
    const root = this.root();
    const dir = this.dir(id);
    await this.readMeta(dir); // must be a problem
    const trashId = `${Date.now()}-${path.basename(dir)}`;
    const dest = path.join(root, TRASH_DIR, trashId);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await renameDir(dir, dest);
    await fs.writeFile(path.join(dest, TRASH_MARKER), JSON.stringify({ id, deletedAt: now() }));
    await removeEmptyParents(path.dirname(dir), root);
    return trashId;
  }

  /** Put a trashed problem back at its old location (with a suffix if that is taken now). */
  async restore(trashId: string): Promise<Problem> {
    const root = this.root();
    if (trashId !== path.basename(trashId)) throw new HttpError(400, "Invalid trash id");
    const src = path.join(root, TRASH_DIR, trashId);
    const marker = JSON.parse(await fs.readFile(path.join(src, TRASH_MARKER), "utf8").catch(() => {
      throw new HttpError(404, "Nothing to restore");
    })) as { id: string };
    let id = marker.id;
    for (let i = 2; await exists(this.dir(id)); i++) id = `${marker.id}-${i}`;
    const dest = this.dir(id);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await renameDir(src, dest);
    await fs.rm(path.join(dest, TRASH_MARKER), { force: true });
    return this.get(id);
  }

  async writeTests(id: string, tests: TestCase[]): Promise<void> {
    const dir = this.dir(id);
    await writeJson(path.join(dir, TESTS_FILE), tests);
    await this.touch(dir);
  }

  private async touch(dir: string) {
    const meta = await this.readMeta(dir);
    await writeJson(path.join(dir, META_FILE), { ...meta, updatedAt: now() });
  }

  private async readMeta(dir: string): Promise<ProblemMeta> {
    return problemMetaSchema.parse(JSON.parse(await fs.readFile(path.join(dir, META_FILE), "utf8")));
  }

  private async readTests(dir: string): Promise<TestCase[]> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, TESTS_FILE), "utf8"));
      return testCaseSchema.array().parse(raw);
    } catch (err: any) {
      if (err.code === "ENOENT") return [];
      throw new HttpError(500, `Could not read tests.json: ${err.message}`);
    }
  }

  /** Template content: the named library template, else the language's default, else built-in. */
  private async template(language: Language, name?: string): Promise<string> {
    const wanted = name ?? this.settings.get(language === "cpp" ? "templates.defaultCpp" : "templates.defaultPython");
    return (await this.library.read("templates", wanted).catch(() => null)) ?? this.library.fallbackTemplate(language);
  }
}

/** fs.rename, retried briefly: on Windows a watcher or antivirus can hold the folder for a moment. */
async function renameDir(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (err: any) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(err.code) || attempt >= 5) {
        throw new HttpError(500, `Could not move folder (${err.code}). Is it open in another program?`);
      }
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

/** Remove now-empty platform/group folders up to (not including) the root. */
async function removeEmptyParents(dir: string, root: string) {
  let cur = dir;
  while (path.relative(root, cur) && !path.relative(root, cur).startsWith("..")) {
    const entries = await fs.readdir(cur).catch(() => null);
    if (!entries || entries.length) return;
    await fs.rmdir(cur).catch(() => {});
    cur = path.dirname(cur);
  }
}

async function exists(p: string) {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

function writeJson(p: string, value: unknown) {
  return writeFileAtomic(p, `${JSON.stringify(value, null, 2)}\n`);
}
