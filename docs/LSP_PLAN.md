# Plan: VS Code-level language intelligence (C++ & Python)

Status: **planned, not started** (later phase — see [PLAN.md](PLAN.md)). This document is the design to
start from.

## Goal

What VS Code gives with the C/C++ / clangd and Pylance extensions, inside the cp-ide editor:

- Completions that understand types (members after `.`/`->`, STL, templates), with signatures
- Hover: type and documentation of the symbol under the cursor
- Signature help while typing call arguments
- Diagnostics as you type (no need to compile first)
- Go to definition / find references / rename symbol (within the problem)
- Formatting and inlay hints (parameter names, deduced `auto` types) as nice-to-haves

## Approach

Run real **language servers** on the backend and talk **LSP** to them from the browser.

```
Monaco (browser) ──WebSocket (JSON-RPC)── server plugin "lsp" ──stdio── clangd / pyright-langserver
```

### Language servers

| Language | Server | Why | How it gets installed |
|---|---|---|---|
| C++ | **clangd** | Industry standard, fast, works with GCC headers via `--query-driver` | LLVM install (`winget install LLVM.LLVM`) or auto-download of a clangd release into `~/.cp-ide/tools/clangd` |
| Python | **basedpyright** (or pyright) | Pylance-level type analysis, ships as an npm package — no Python deps | `pnpm add basedpyright` in the plugin (runs on our Node) |

Alternatives considered: `ccls` (less maintained), `python-lsp-server`/jedi (weaker types, needs pip).

### clangd setup details (the tricky part)

- **Headers**: clangd ships its own Clang but must find MinGW's libstdc++ (`bits/stdc++.h`). Start it
  with `--query-driver=<absolute path of cpp.compiler>` so it asks g++ for its include paths.
- **Flags**: write a `compile_flags.txt` (one flag per line, e.g. `-std=c++20`, `-DLOCAL`, `-xc++`)
  generated from `cpp.standard` / `cpp.flags`. Put it in the problems root so every problem folder
  inherits it; regenerate when those settings change.
- **Speed**: `bits/stdc++.h` is large; clangd builds a preamble once (~1–3 s) and reuses it. Use
  `--background-index=false` (single-file problems don't need an index), `--header-insertion=never`,
  `--completion-style=detailed`, `--pch-storage=memory`.
- Memory: ~150–400 MB per clangd process; run one per language, start lazily on first C++ file,
  stop after N minutes idle.

### Client side: thin custom client (recommended) vs monaco-languageclient

- `monaco-languageclient` (TypeFox) now builds on `@codingame/monaco-vscode-api`, which replaces large
  parts of the Monaco stack with VS Code's services — heavy, and a risky fit with our standalone
  Monaco 0.57 setup, theming, vim mode and snippet controller.
- **Recommended**: a small client in the plugin that speaks JSON-RPC over a WebSocket and maps a
  curated subset of LSP to Monaco providers:
  `textDocument/completion` (+ `completionItem/resolve`) → `registerCompletionItemProvider`,
  `hover` → `registerHoverProvider`, `signatureHelp` → `registerSignatureHelpProvider`,
  `publishDiagnostics` → `editor.setModelMarkers(model, "lsp", …)`, `definition`/`references` →
  definition/reference providers, `rename`, `formatting`, `inlayHint`. Roughly 600–900 lines and full
  control over behaviour. LSP types from `vscode-languageserver-protocol` (types only).

### Document sync

- URIs are the real files: `file:///C:/Users/…/cp/<problem id>/main.cpp` (problemsRoot + id). Careful
  with Windows drive letters and percent-encoding.
- `didOpen` when a problem file is shown, `didChange` (full text, debounced ~150 ms — files are small)
  on buffer edits, `didSave` on save, `didClose` when the problem closes. The Templates & Snippets
  editor does not attach (no real file / not a translation unit).
- Workspace folder: the problems root (`rootUri`), so cross-file navigation within a problem works.
- Diagnostics from LSP use their own marker owner and coexist with the compiler's markers.

### Server plugin (`plugins/lsp`)

- Needs WebSocket support for plugins: expose an `upgradeWebSocket` helper on `ServerPluginContext`
  (Hono `@hono/node-ws`; `injectWebSocket(server)` in `apps/server/src/index.ts`). The Playground phase
  needs the same thing, so it lands there first.
- One process per language, spawned on demand; restart on crash with backoff; stop on idle.
- Settings: `lsp.enabled`, `lsp.cpp.enabled`, `lsp.cpp.clangdPath`, `lsp.python.enabled`,
  `lsp.python.serverPath`, `lsp.diagnosticsAsYouType`.
- Status bar item: "clangd ●" (starting / ready / error with tooltip), command "Restart language servers".
- The toolchain plugin reports whether clangd/pyright are available, with install hints.

## Phases

1. **L1 — Plumbing + C++ basics**: plugin WebSocket support, clangd spawn/bridge, document sync,
   diagnostics + completion. Verify `bits/stdc++.h` resolution with MinGW.
2. **L2 — Navigation & help**: hover, signature help, go to definition, find references.
3. **L3 — Python**: basedpyright with the same client; per-language settings.
4. **L4 — Polish**: rename, formatting via LSP (could replace clang-format), inlay hints, auto-download
   of clangd, idle shutdown, status/restart UI.

## Risks / open questions

- clangd + MinGW header discovery on each user's toolchain (MSYS2 vs WinLibs layouts) — `--query-driver`
  usually solves it; fall back to explicit `-isystem` flags in `compile_flags.txt`.
- Completion noise from `using namespace std;` + `bits/stdc++.h` (huge symbol set) — rely on clangd's
  ranking, limit result count, keep snippet suggestions visible.
- Vim mode key handling with signature help / completion widgets.
- Snippet completions and LSP completions side by side (separate providers — Monaco merges them).
