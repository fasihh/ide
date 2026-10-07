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
    // Snippets use Monaco snippet syntax: \${1:name} placeholders (Tab moves between them), $0 = final cursor.
    "segtree.cpp": `// @description Iterative segment tree: point update, range query [l, r)
template <class T> struct SegTree {
    int n;
    vector<T> t;
    T id;
    function<T(T, T)> f;
    SegTree(int n, T id, function<T(T, T)> f) : n(n), t(2 * n, id), id(id), f(f) {}
    void set(int i, T v) {
        for (t[i += n] = v; i > 1; i >>= 1) t[i >> 1] = f(t[i & ~1], t[i | 1]);
    }
    T query(int l, int r) {
        T a = id, b = id;
        for (l += n, r += n; l < r; l >>= 1, r >>= 1) {
            if (l & 1) a = f(a, t[l++]);
            if (r & 1) b = f(t[--r], b);
        }
        return f(a, b);
    }
};
SegTree<\${1:long long}> \${2:st}(\${3:n}, \${4:0}, [](\${1:long long} a, \${1:long long} b) { return \${5:a + b}; });
$0`,
    "modint.cpp": `// @description Modular integer (+ - * /, pow, inverse)
template <int MOD> struct Mint {
    int v;
    Mint(long long x = 0) { v = int(x % MOD); if (v < 0) v += MOD; }
    Mint& operator+=(Mint o) { if ((v += o.v) >= MOD) v -= MOD; return *this; }
    Mint& operator-=(Mint o) { if ((v -= o.v) < 0) v += MOD; return *this; }
    Mint& operator*=(Mint o) { v = int(1LL * v * o.v % MOD); return *this; }
    Mint pow(long long e) const { Mint r = 1, b = *this; for (; e; e >>= 1, b *= b) if (e & 1) r *= b; return r; }
    Mint inv() const { return pow(MOD - 2); }
    Mint& operator/=(Mint o) { return *this *= o.inv(); }
    friend Mint operator+(Mint a, Mint b) { return a += b; }
    friend Mint operator-(Mint a, Mint b) { return a -= b; }
    friend Mint operator*(Mint a, Mint b) { return a *= b; }
    friend Mint operator/(Mint a, Mint b) { return a /= b; }
    friend ostream& operator<<(ostream& os, Mint a) { return os << a.v; }
};
using mint = Mint<\${1:998244353}>;
$0`,
    "dijkstra.cpp": `// @description Dijkstra on vector<vector<pair<int, long long>>> (to, weight)
vector<long long> dijkstra(const vector<vector<pair<int, long long>>>& g, int src) {
    vector<long long> d(g.size(), LLONG_MAX);
    priority_queue<pair<long long, int>, vector<pair<long long, int>>, greater<>> pq;
    d[src] = 0;
    pq.push({0, src});
    while (!pq.empty()) {
        auto [du, u] = pq.top();
        pq.pop();
        if (du != d[u]) continue;
        for (auto [v, w] : g[u])
            if (du + w < d[v]) d[v] = du + w, pq.push({d[v], v});
    }
    return d;
}
$0`,
    "sieve.cpp": `// @description Linear sieve: primes up to N and smallest prime factors
const int N = \${1:1000000};
vector<int> spf(N + 1), primes;
void sieve() {
    for (int i = 2; i <= N; i++) {
        if (!spf[i]) spf[i] = i, primes.push_back(i);
        for (int p : primes) {
            if (p > spf[i] || 1LL * i * p > N) break;
            spf[i * p] = p;
        }
    }
}
$0`,
    "dsu.py": `# @description Disjoint set union with path halving and union by size
class DSU:
    def __init__(self, n):
        self.p = list(range(n))
        self.sz = [1] * n

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def unite(self, a, b):
        a, b = self.find(a), self.find(b)
        if a == b:
            return False
        if self.sz[a] < self.sz[b]:
            a, b = b, a
        self.p[b] = a
        self.sz[a] += self.sz[b]
        return True
`,
  },
};

/** Defaults shipped before per-name seeding existed (an empty `.seeded` marker means these were offered). */
const FIRST_RELEASE: Record<LibraryKind, string[]> = {
  templates: ["main.cpp", "main.py", "multitest.cpp"],
  snippets: ["dsu.cpp", "binpow.cpp", "fenwick.cpp", "fast_input.py"],
};

/** Interactor templates: created next to the solution when a problem is made interactive. */
export const INTERACTOR_TEMPLATES: Record<Language, { name: string; content: string }> = {
  cpp: {
    name: "interactor.cpp",
    content: `// Interactor — plays the judge for an interactive problem.
// Started as: interactor <input-file> <output-file> <answer-file>
//   argv[1]  the test's "input" (hidden data only the judge knows)
//   argv[3]  the test's "expected" (optional)
// Talk to the solution through cin/cout and flush after every message (endl does).
// Exit code is the verdict: 0 = accepted, 1 = wrong answer, 2 = presentation error, 3 = judge bug.
// Anything written to cerr is shown next to the verdict.
//
// Example protocol (guess the number): the judge prints n; the solution asks "? x" and gets
// "<" (secret is larger), ">" (secret is smaller) or "="; it answers "! x". Max 30 queries.
#include <bits/stdc++.h>
using namespace std;

int main(int, char* argv[]) {
    ifstream test(argv[1]);
    long long n, secret;
    test >> n >> secret;
    cout << n << endl;
    for (int queries = 0; queries <= 30; queries++) {
        string type;
        long long x;
        if (!(cin >> type >> x)) { cerr << "solution stopped talking" << endl; return 1; }
        if (type == "!") {
            if (x == secret) { cerr << "correct after " << queries << " queries" << endl; return 0; }
            cerr << "wrong answer " << x << ", secret was " << secret << endl;
            return 1;
        }
        if (type != "?") { cerr << "unknown command " << type << endl; return 2; }
        cout << (x < secret ? "<" : x > secret ? ">" : "=") << endl;
    }
    cerr << "more than 30 queries" << endl;
    return 1;
}
`,
  },
  python: {
    name: "interactor.py",
    content: `# Interactor — plays the judge for an interactive problem.
# Started as: interactor <input-file> <output-file> <answer-file>
#   sys.argv[1]  the test's "input" (hidden data only the judge knows)
#   sys.argv[3]  the test's "expected" (optional)
# Talk to the solution through print()/input() and flush after every message.
# Exit code is the verdict: 0 = accepted, 1 = wrong answer, 2 = presentation error, 3 = judge bug.
# Anything written to stderr is shown next to the verdict.
#
# Example protocol (guess the number): the judge prints n; the solution asks "? x" and gets
# "<" (secret is larger), ">" (secret is smaller) or "="; it answers "! x". Max 30 queries.
import sys

n, secret = map(int, open(sys.argv[1]).read().split())
print(n, flush=True)
for queries in range(31):
    try:
        kind, x = input().split()
        x = int(x)
    except (EOFError, ValueError):
        print("solution stopped talking", file=sys.stderr)
        sys.exit(1)
    if kind == "!":
        if x == secret:
            print(f"correct after {queries} queries", file=sys.stderr)
            sys.exit(0)
        print(f"wrong answer {x}, secret was {secret}", file=sys.stderr)
        sys.exit(1)
    if kind != "?":
        print(f"unknown command {kind}", file=sys.stderr)
        sys.exit(2)
    print("<" if x < secret else ">" if x > secret else "=", flush=True)
print("more than 30 queries", file=sys.stderr)
sys.exit(1)
`,
  },
};

/** Templates and snippets: plain .cpp/.py files under `~/.cp-ide/<kind>/`. */
export class LibraryService {
  private dir(kind: LibraryKind) {
    return path.join(DATA_DIR, kind);
  }

  private seeded = new Set<LibraryKind>();

  /**
   * Create the folder and add each default once. `.seeded` lists the defaults already offered, so
   * new defaults appear after an update while deleted ones don't come back. (An empty marker is the
   * old format: everything from the first release counts as seeded.)
   */
  private async ensure(kind: LibraryKind) {
    const dir = this.dir(kind);
    if (this.seeded.has(kind)) return dir;
    await fs.mkdir(dir, { recursive: true });
    const marker = path.join(dir, ".seeded");
    const raw = await fs.readFile(marker, "utf8").catch(() => null);
    let done: string[] = [];
    if (raw !== null) {
      try {
        done = raw.trim() ? JSON.parse(raw) : FIRST_RELEASE[kind];
      } catch {
        done = FIRST_RELEASE[kind];
      }
    }
    const missing = Object.keys(DEFAULTS[kind]).filter((n) => !done.includes(n));
    for (const name of missing) {
      await fs.writeFile(path.join(dir, name), DEFAULTS[kind][name]!, { flag: "wx" }).catch(() => {});
    }
    if (missing.length || raw === null || !raw.trim()) await fs.writeFile(marker, JSON.stringify([...done, ...missing]));
    this.seeded.add(kind);
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
