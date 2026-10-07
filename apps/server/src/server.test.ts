/**
 * Integration tests against the real toolchain (g++ and python on PATH).
 * Uses a throwaway CP_IDE_HOME so nothing touches ~/.cp-ide.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "cp-ide-test-"));
process.env.CP_IDE_HOME = home;

const { SettingsService } = await import("./services/settings.ts");
const { ProblemsService } = await import("./services/problems.ts");
const { RunnerService } = await import("./runner/runner.ts");

const settings = new SettingsService();
const runner = new RunnerService(settings);
const problems = new ProblemsService(settings);

before(async () => {
  await settings.update({ "problems.root": path.join(home, "cp").replace(/\\/g, "/") });
});
after(async () => {
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

async function compile(language: "cpp" | "python", source: string) {
  const res = await runner.compile({ language, source, fileName: language === "cpp" ? "main.cpp" : "main.py" });
  if (!res.ok) assert.fail(`compile failed: ${res.stderr}`);
  return res.artifactId;
}

describe("runner", () => {
  const sum = `#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}`;

  test("C++ AC / WA / RAN and cache hit", async () => {
    const id = await compile("cpp", sum);
    assert.equal((await runner.exec({ artifactId: id, input: "1 2", expected: "3" })).verdict, "AC");
    const wa = await runner.exec({ artifactId: id, input: "1 2", expected: "4" });
    assert.equal(wa.verdict, "WA");
    assert.equal(wa.diff?.actualToken, "3");
    assert.equal((await runner.exec({ artifactId: id, input: "1 2" })).verdict, "RAN");
    const again = await runner.compile({ language: "cpp", source: sum });
    assert.ok(again.ok && again.cached);
  });

  test("C++ compile error mentions main.cpp, not the cache path", async () => {
    const res = await runner.compile({ language: "cpp", source: "int main(){ int x = ; }", fileName: "main.cpp" });
    assert.equal(res.ok, false);
    assert.match(res.stderr, /main\.cpp:1:\d+: error/);
    assert.doesNotMatch(res.stderr, /cache/);
  });

  test("TLE and RE", async () => {
    const loop = await compile("cpp", "int main(){ volatile int x = 0; while(true) x++; }");
    assert.equal((await runner.exec({ artifactId: loop, input: "", timeLimitMs: 300 })).verdict, "TLE");
    const crash = await compile("cpp", "#include <cstdlib>\nint main(){ return 3; }");
    const re = await runner.exec({ artifactId: crash, input: "" });
    assert.equal(re.verdict, "RE");
    assert.ok(re.message);
  });

  test("Python AC and runtime error mapped to main.py", async () => {
    const id = await compile("python", "a, b = map(int, input().split())\nprint(a + b)\n");
    assert.equal((await runner.exec({ artifactId: id, input: "2 3", expected: "5" })).verdict, "AC");
    const re = await runner.exec({ artifactId: id, input: "x y", expected: "5" });
    assert.equal(re.verdict, "RE");
    assert.match(re.stderr, /main\.py/);
  });

  test("Python syntax error is CE", async () => {
    const res = await runner.compile({ language: "python", source: "def f(:\n  pass\n", fileName: "main.py" });
    assert.equal(res.ok, false);
    assert.match(res.stderr, /SyntaxError/);
  });
});

describe("problems", () => {
  test("create, list, get, update and write", async () => {
    const p = await problems.create({ name: "A. Test Problem", platform: "codeforces", group: "Round 1", tests: [{ input: "1", expected: "1" }] });
    assert.equal(p.id, "codeforces/round-1/a-test-problem");
    assert.equal(p.tests.length, 1);
    assert.ok(p.files.some((f) => f.name === "main.cpp"));

    const dup = await problems.create({ name: "A. Test Problem", platform: "codeforces", group: "Round 1" });
    assert.equal(dup.id, "codeforces/round-1/a-test-problem-2");

    const list = await problems.list();
    assert.equal(list.length, 2);

    await problems.writeFile(p.id, "main.cpp", "// hi");
    await problems.updateMeta(p.id, { status: "solved", language: "python" });
    const again = await problems.get(p.id);
    assert.equal(again.meta.status, "solved");
    assert.equal(again.meta.mainFile, "main.py");
    assert.equal(again.files.find((f) => f.name === "main.cpp")?.content, "// hi");
  });

  test("extra files: create from template, rename, delete; main file rules", async () => {
    const p = await problems.createScratch("cpp");
    await problems.createFile(p.id, "brute.py");
    await problems.createFile(p.id, "1.in", "5\n");
    let got = await problems.get(p.id);
    assert.match(got.files.find((f) => f.name === "brute.py")!.content, /def solve/);
    assert.equal(got.files.find((f) => f.name === "1.in")!.content, "5\n");
    await assert.rejects(problems.createFile(p.id, "brute.py"), /already exists/);

    await problems.renameFile(p.id, "brute.py", "gen.py");
    await problems.deleteFile(p.id, "1.in");
    await assert.rejects(problems.deleteFile(p.id, "main.cpp"), /main file/);
    got = await problems.get(p.id);
    assert.deepEqual(got.files.map((f) => f.name).sort(), ["gen.py", "main.cpp"]);

    // Renaming the main file follows it (and switches language by extension).
    await problems.renameFile(p.id, "main.cpp", "sol.py");
    got = await problems.get(p.id);
    assert.equal(got.meta.mainFile, "sol.py");
    assert.equal(got.meta.language, "python");
    await assert.rejects(problems.renameFile(p.id, "sol.py", "sol.txt"), /must stay/);
  });

  test("rejects paths outside the root and bad file names", async () => {
    await assert.rejects(problems.get("../../etc"));
    const p = await problems.createScratch("cpp");
    await assert.rejects(problems.writeFile(p.id, "../evil.cpp", "x"));
    await assert.rejects(problems.writeFile(p.id, "run.exe", "x"));
  });
});
