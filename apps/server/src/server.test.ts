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
const { LibraryService } = await import("./services/library.ts");
const { ProblemsWatcher } = await import("./services/watcher.ts");
const { INTERACTOR_TEMPLATES } = await import("./services/library.ts");

const settings = new SettingsService();
const runner = new RunnerService(settings);
const library = new LibraryService();
const problems = new ProblemsService(settings, library);

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

  test("move renames the folder, trash + restore round-trips", async () => {
    const p = await problems.create({ name: "C. Old Name", platform: "codeforces", group: "Round 7" });
    const moved = await problems.move(p.id, { name: "C. New Name", group: "Round 8" });
    assert.equal(moved.id, "codeforces/round-8/c-new-name");
    assert.equal(moved.meta.name, "C. New Name");
    assert.equal(moved.meta.group, "Round 8");
    // The emptied "round-7" folder is cleaned up.
    await assert.rejects(fs.access(path.join(problems.root(), "codeforces", "round-7")));

    const other = await problems.create({ name: "C. New Name", platform: "codeforces", group: "Round 9" });
    await assert.rejects(problems.move(other.id, { group: "Round 8" }), /already exists/);

    const trashId = await problems.trash(moved.id);
    assert.ok(!(await problems.list()).some((x) => x.id === moved.id));
    const restored = await problems.restore(trashId);
    assert.equal(restored.id, moved.id);
    assert.equal(restored.meta.name, "C. New Name");
  });

  test("templates: named template on create, default from settings", async () => {
    await library.create("templates", "tiny.cpp", "// tiny\n");
    const p = await problems.create({ name: "T", platform: "custom", group: "t", template: "tiny.cpp" });
    assert.equal(p.files.find((f) => f.name === "main.cpp")?.content, "// tiny\n");
    await settings.update({ "templates.defaultCpp": "tiny.cpp" });
    const q = await problems.create({ name: "U", platform: "custom", group: "t" });
    assert.equal(q.files.find((f) => f.name === "main.cpp")?.content, "// tiny\n");
    await settings.update({ "templates.defaultCpp": null });
  });

  test("rejects paths outside the root and bad file names", async () => {
    await assert.rejects(problems.get("../../etc"));
    const p = await problems.createScratch("cpp");
    await assert.rejects(problems.writeFile(p.id, "../evil.cpp", "x"));
    await assert.rejects(problems.writeFile(p.id, "run.exe", "x"));
  });
});

describe("library", () => {
  test("seeds defaults once, CRUD, rejects bad names", async () => {
    const templates = await library.list("templates");
    assert.ok(templates.some((t) => t.name === "main.cpp") && templates.some((t) => t.name === "main.py"));
    const snippets = await library.list("snippets");
    assert.ok(snippets.some((t) => t.name === "dsu.cpp"));

    await library.remove("snippets", "dsu.cpp");
    assert.ok(!(await library.list("snippets")).some((t) => t.name === "dsu.cpp"), "deleted defaults stay deleted");

    await library.create("snippets", "tree.cpp", "struct Tree {};\n");
    await library.rename("snippets", "tree.cpp", "mytree.cpp");
    await library.save("snippets", "mytree.cpp", "struct MyTree {};\n");
    assert.equal(await library.read("snippets", "mytree.cpp"), "struct MyTree {};\n");
    await assert.rejects(library.create("snippets", "../evil.cpp"));
    await assert.rejects(library.create("snippets", "mytree.cpp"), /already exists/);
  });
});

describe("watcher", () => {
  test("reports the problem folder of changed files", async () => {
    const p = await problems.createScratch("cpp");
    const seen: string[][] = [];
    const w = new ProblemsWatcher((ids) => seen.push(ids));
    w.watch(problems.root());
    await new Promise((r) => setTimeout(r, 200));
    await fs.writeFile(path.join(problems.dir(p.id), "main.cpp"), "// external edit\n");
    await new Promise((r) => setTimeout(r, 1000));
    w.close();
    assert.ok(seen.flat().includes(p.id), `expected ${p.id} in ${JSON.stringify(seen)}`);
  });
});

describe("interactive", () => {
  const solve = String.raw`#include <bits/stdc++.h>
using namespace std;
int main() {
    long long n; cin >> n;
    long long lo = 1, hi = n;
    while (lo < hi) {
        long long mid = (lo + hi) / 2;
        cout << "? " << mid << endl;
        string r; cin >> r;
        if (r == "=") { lo = hi = mid; break; }
        if (r == "<") lo = mid + 1; else hi = mid - 1;
    }
    cout << "! " << lo << endl;
}`;
  const interactorCpp = INTERACTOR_TEMPLATES.cpp.content;

  async function both(solutionSrc: string, language: "cpp" | "python" = "cpp") {
    const sol = await compile(language, solutionSrc);
    const inter = await compile("cpp", interactorCpp);
    return (input: string, timeLimitMs = 2000) => runner.interact({ artifactId: sol, interactorArtifactId: inter, input, timeLimitMs });
  }

  test("AC with transcript, WA when the guess is wrong", async () => {
    const run = await both(solve);
    const ac = await run("1000 777");
    assert.equal(ac.verdict, "AC", ac.message ?? "");
    assert.match(ac.interactorStderr ?? "", /correct after/);
    assert.ok(ac.transcript && ac.transcript[0]?.from === "interactor" && ac.transcript[0].text.startsWith("1000"));
    assert.ok(ac.transcript?.some((t) => t.from === "solution" && t.text.includes("! 777")));

    const wrong = await both(String.raw`#include <iostream>
int main() { long long n; std::cin >> n; std::cout << "! 1" << std::endl; }`);
    const wa = await wrong("10 5");
    assert.equal(wa.verdict, "WA");
    assert.match(wa.message ?? "", /wrong answer 1, secret was 5/);
  });

  test("TLE when the solution never answers or forgets to flush", async () => {
    const silent = await both("int main() { while (true) {} }");
    assert.equal((await silent("10 5", 300)).verdict, "TLE");
    // No flush: both sides wait on each other forever.
    const noFlush = await both(String.raw`#include <cstdio>
int main() { long long n; scanf("%lld", &n); printf("! 5\n"); while (true) {} }`);
    assert.equal((await noFlush("10 5", 300)).verdict, "TLE");
  });

  test("interactor crash and Python solutions", async () => {
    const sol = await compile("cpp", solve);
    const bad = await compile("cpp", "int main() { int *p = nullptr; return *p; }");
    const crash = await runner.interact({ artifactId: sol, interactorArtifactId: bad, input: "10 5" });
    assert.equal(crash.verdict, "RE");
    assert.match(crash.message ?? "", /Interactor crashed/);

    const py = await both(
      'n = int(input())\nlo, hi = 1, n\nwhile lo < hi:\n    mid = (lo + hi) // 2\n    print("?", mid, flush=True)\n    r = input()\n    if r == "=":\n        lo = hi = mid\n        break\n    if r == "<":\n        lo = mid + 1\n    else:\n        hi = mid - 1\nprint("!", lo, flush=True)\n',
      "python",
    );
    assert.equal((await py("100 42")).verdict, "AC");
  });

  test("making a problem interactive creates the interactor", async () => {
    const p = await problems.create({ name: "Guess", platform: "custom", group: "i" });
    const meta = await problems.updateMeta(p.id, { interactive: true });
    assert.equal(meta.interactor, "interactor.cpp");
    const got = await problems.get(p.id);
    assert.match(got.files.find((f) => f.name === "interactor.cpp")?.content ?? "", /plays the judge/);
  });
});

describe("library seeding", () => {
  test("old empty marker: new defaults are added once, first-release ones are not re-added", async () => {
    const dir = path.join(home, "snippets");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, ".seeded"), "");
    const fresh = new LibraryService();
    const names = (await fresh.list("snippets")).map((s) => s.name);
    assert.ok(names.includes("segtree.cpp") && names.includes("dsu.py"));
    assert.ok(!names.includes("dsu.cpp"), "dsu.cpp was part of the first release and had been removed");
    assert.match((await fresh.read("snippets", "segtree.cpp")) ?? "", /@description/);
  });
});

describe("live sessions", () => {
  test("runner.start streams output and takes stdin; kill stops it", async () => {
    const id = await compile("python", 'name = input("name? ")\nprint("hi", name)\n');
    const s = runner.start(id)!;
    let out = "";
    s.onStdout((d) => (out += d));
    const exit = new Promise<{ exitCode: number | null; message?: string }>((r) => s.onExit(r));
    await new Promise((r) => setTimeout(r, 400));
    assert.match(out, /name\? /, "prompt is visible before input (unbuffered)");
    s.write("ada\n");
    const info = await exit;
    assert.equal(info.exitCode, 0);
    assert.match(out, /hi ada/);

    const loop = runner.start(await compile("cpp", "int main() { while (true) {} }"))!;
    const stopped = new Promise<{ message?: string }>((r) => loop.onExit(r));
    loop.kill();
    assert.equal((await stopped).message, "Stopped");
  });

  test("websocket router rejects foreign origins", async () => {
    const http = await import("node:http");
    const { WebSocket } = await import("ws");
    const { SocketRouter } = await import("./sockets.ts");
    const router = new SocketRouter();
    router.add("/api/plugins/test/echo", (sock) => sock.onMessage((m) => sock.send(`echo:${m}`)));
    const server = http.createServer();
    router.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const connect = (origin: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/plugins/test/echo`, { headers: { Origin: origin } });
        ws.on("open", () => ws.send("hi"));
        ws.on("message", (m) => {
          resolve(m.toString());
          ws.close();
        });
        ws.on("error", () => resolve("rejected"));
        ws.on("unexpected-response", () => resolve("rejected"));
      });
    assert.equal(await connect("http://localhost:5173"), "echo:hi");
    assert.equal(await connect("https://evil.example"), "rejected");
    server.close();
  });
});
