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
import { TEMPLATES_DIR, expandHome, resolveInside } from "../paths.ts";
import { HttpError } from "../errors.ts";
import type { SettingsService } from "./settings.ts";

const META_FILE = "problem.json";
const TESTS_FILE = "tests.json";
const SOURCE_EXTS = new Set([".cpp", ".cc", ".cxx", ".h", ".hpp", ".py", ".txt", ".in", ".out", ".md"]);
const MAX_SCAN_DEPTH = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const DEFAULT_TEMPLATES: Record<Language, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

#ifdef LOCAL
#define dbg(x) cerr << #x << " = " << (x) << endl
#else
#define dbg(x)
#endif

void solve() {

}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t = 1;
    // cin >> t;
    while (t--) solve();
}
`,
  python: `import sys
input = sys.stdin.readline


def solve():
    pass


def main():
    t = 1
    # t = int(input())
    for _ in range(t):
        solve()


main()
`,
};

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

    await fs.writeFile(path.join(dir, mainFile), await this.template(language));
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
    if (file !== path.basename(file) || !SOURCE_EXTS.has(path.extname(file).toLowerCase())) {
      throw new HttpError(400, `Not an editable file name: ${file}`);
    }
    const dir = this.dir(id);
    await fs.writeFile(path.join(dir, file), content);
    await this.touch(dir);
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

  /** User template from ~/.cp-ide/templates/main.<ext>, created with a default on first use. */
  private async template(language: Language): Promise<string> {
    const p = path.join(TEMPLATES_DIR, `main.${LANGUAGE_INFO[language].ext}`);
    try {
      return await fs.readFile(p, "utf8");
    } catch {
      await fs.mkdir(TEMPLATES_DIR, { recursive: true });
      await fs.writeFile(p, DEFAULT_TEMPLATES[language]);
      return DEFAULT_TEMPLATES[language];
    }
  }
}

async function exists(p: string) {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

async function writeJson(p: string, value: unknown) {
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, p);
}
