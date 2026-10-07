import fs from "node:fs/promises";
import path from "node:path";
import { type Language, type LibraryItem, type LibraryKind, libraryNameSchema } from "@cp-ide/shared";
import { DATA_DIR } from "../paths.ts";
import { HttpError } from "../errors.ts";

const languageOf = (name: string): Language => (name.endsWith(".py") ? "python" : "cpp");

/** Seeded the first time a library folder is used. Users edit them in the Templates panel. */
const DEFAULTS: Record<LibraryKind, Record<string, string>> = {
  templates: {
    "main.cpp": `#include <bits/stdc++.h>
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
    "multitest.cpp": `#include <bits/stdc++.h>
using namespace std;
using ll = long long;

void solve() {

}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t--) solve();
}
`,
    "main.py": `import sys
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
  },
  snippets: {
    "dsu.cpp": `struct DSU {
    vector<int> p, sz;
    DSU(int n) : p(n), sz(n, 1) { iota(p.begin(), p.end(), 0); }
    int find(int x) { return p[x] == x ? x : p[x] = find(p[x]); }
    bool unite(int a, int b) {
        a = find(a), b = find(b);
        if (a == b) return false;
        if (sz[a] < sz[b]) swap(a, b);
        p[b] = a, sz[a] += sz[b];
        return true;
    }
};
`,
    "binpow.cpp": `long long binpow(long long b, long long e, long long m) {
    long long r = 1;
    b %= m;
    while (e > 0) {
        if (e & 1) r = r * b % m;
        b = b * b % m;
        e >>= 1;
    }
    return r;
}
`,
    "fenwick.cpp": `struct Fenwick {
    int n;
    vector<long long> t;
    Fenwick(int n) : n(n), t(n + 1) {}
    void add(int i, long long v) { for (++i; i <= n; i += i & -i) t[i] += v; }
    long long sum(int i) { long long s = 0; for (++i; i > 0; i -= i & -i) s += t[i]; return s; }  // [0, i]
    long long sum(int l, int r) { return sum(r) - (l ? sum(l - 1) : 0); }
};
`,
    "fast_input.py": `import sys
data = sys.stdin.buffer.read().split()
pos = 0


def read_int():
    global pos
    pos += 1
    return int(data[pos - 1])
`,
  },
};

/** Templates and snippets: plain .cpp/.py files under `~/.cp-ide/<kind>/`. */
export class LibraryService {
  private dir(kind: LibraryKind) {
    return path.join(DATA_DIR, kind);
  }

  /** Create the folder and add the defaults once (a marker keeps deleted defaults from coming back). */
  private async ensure(kind: LibraryKind) {
    const dir = this.dir(kind);
    const marker = path.join(dir, ".seeded");
    if (await fs.access(marker).then(() => true, () => false)) return dir;
    await fs.mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(DEFAULTS[kind])) {
      await fs.writeFile(path.join(dir, name), content, { flag: "wx" }).catch(() => {});
    }
    await fs.writeFile(marker, "");
    return dir;
  }

  private file(kind: LibraryKind, name: string) {
    const res = libraryNameSchema.safeParse(name);
    if (!res.success) throw new HttpError(400, `Invalid name "${name}": ${res.error.issues[0]?.message}`);
    return path.join(this.dir(kind), name);
  }

  async list(kind: LibraryKind): Promise<LibraryItem[]> {
    const dir = await this.ensure(kind);
    const names = (await fs.readdir(dir)).filter((n) => libraryNameSchema.safeParse(n).success).sort();
    return Promise.all(names.map(async (name) => ({ name, language: languageOf(name), content: await fs.readFile(path.join(dir, name), "utf8") })));
  }

  /** Content of an item, or null when it doesn't exist. */
  async read(kind: LibraryKind, name: string): Promise<string | null> {
    await this.ensure(kind);
    return fs.readFile(this.file(kind, name), "utf8").catch(() => null);
  }

  async save(kind: LibraryKind, name: string, content: string) {
    await this.ensure(kind);
    await fs.writeFile(this.file(kind, name), content);
  }

  async create(kind: LibraryKind, name: string, content = "") {
    await this.ensure(kind);
    await fs.writeFile(this.file(kind, name), content, { flag: "wx" }).catch((err) => {
      throw err.code === "EEXIST" ? new HttpError(409, `${name} already exists`) : err;
    });
  }

  async rename(kind: LibraryKind, from: string, to: string) {
    await this.ensure(kind);
    const dst = this.file(kind, to);
    if (await fs.access(dst).then(() => true, () => false)) throw new HttpError(409, `${to} already exists`);
    await fs.rename(this.file(kind, from), dst);
  }

  async remove(kind: LibraryKind, name: string) {
    await fs.rm(this.file(kind, name));
  }

  /** Built-in fallback when a template file is missing. */
  fallbackTemplate(language: Language) {
    return DEFAULTS.templates[language === "cpp" ? "main.cpp" : "main.py"]!;
  }
}
