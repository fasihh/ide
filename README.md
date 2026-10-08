# cp-ide

A local, browser-based IDE for competitive programming in **C++** and **Python**. Code, custom
tests and verdicts are side by side in resizable, closable panels, and every problem is stored as plain
files under one folder.

## Requirements

- Node 20+ and pnpm 10
- `g++` on PATH (MinGW/MSYS2/WinLibs on Windows) and `python`. Both can be changed in Settings
- Optional: `clangd` on PATH for C++ completions/diagnostics as you type (`winget install LLVM.LLVM`,
  `pip install clangd`, …). Python language support (basedpyright) is bundled

## Run

```bash
pnpm install
pnpm dev        # API on :7420 + Vite on http://localhost:5173
```

Or as a single server with the production build:

```bash
pnpm start      # builds the web app, serves everything on http://localhost:7420
```

Data locations:
- Problems: `~/cp` (Settings → Problems root)
- Settings, templates, compile cache: `~/.cp-ide` (override with `CP_IDE_HOME`)
- Templates and snippets: `~/.cp-ide/templates`, `~/.cp-ide/snippets` (edit them in the
  **Templates & Snippets** panel, from the command palette)
- Deleted problems go to `<problems root>/.trash`

## Shortcuts

All of these can be changed in **Keyboard Shortcuts** (Ctrl+Alt+K).

| Keys | Action |
|---|---|
| Ctrl+P | Palette: problems and files (type `>` commands, `#` panels, `!` layouts, `:` line, `?` help) |
| Ctrl+Shift+P / Ctrl+Alt+P / Ctrl+G | Palette in commands / panels / go-to-line mode |
| Ctrl+Enter / Ctrl+Shift+Enter | Run (tests, or the terminal for Playground-mode problems / the Playground) / run with custom input |
| Ctrl+S · Shift+Alt+F | Save · format document |
| Alt+N / Alt+Shift+N | New scratch problem / new problem |
| F2 | Rename symbol (in code) · rename the current file (elsewhere) |
| Alt+G | Playground (Ctrl+Enter runs it, type input in the Terminal) |
| Alt+T | Add test |
| Ctrl+Alt+I · `@` in the palette | Insert snippet (Tab moves between placeholders) |
| Ctrl+B / Ctrl+J | Toggle problems / output panel |
| Alt+1…4 | Code / Tests / Problem / Custom Input panel |
| Ctrl+Alt+1…4 | Default / Focus / Zen / Everything layout |
| Ctrl+, · Ctrl+Alt+K | Settings · keyboard shortcuts |

## Scripts

`pnpm typecheck` · `pnpm test` · `pnpm build`

## Docs

Start with [docs/README.md](docs/README.md). [docs/PLAN.md](docs/PLAN.md) has the phase plan, and
[docs/PLUGINS.md](docs/PLUGINS.md) explains how to add new tools.
