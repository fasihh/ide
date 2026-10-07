# cp-ide

A local, browser-based IDE for competitive programming in **C++** and **Python**. Code, custom
tests and verdicts are side by side in resizable, closable panels, and every problem is stored as plain
files under one folder.

## Requirements

- Node 20+ and pnpm 10
- `g++` on PATH (MinGW/MSYS2/WinLibs on Windows) and `python`. Both can be changed in Settings

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
- Edit `~/.cp-ide/templates/main.cpp` / `main.py` to change the template for new problems

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+Enter | Run all tests |
| Ctrl+S | Save |
| Alt+N / Alt+Shift+N | New scratch problem / New problem |
| Alt+T | Add test |
| Ctrl+B / Ctrl+J | Toggle problems / output panel |
| Alt+1 / Alt+2 / Alt+3 | Code / Tests / Problem panel |
| Ctrl+, | Settings |

## Scripts

`pnpm typecheck` · `pnpm test` · `pnpm build`

## Docs

Start with [docs/README.md](docs/README.md). [docs/PLAN.md](docs/PLAN.md) has the phase plan, and
[docs/PLUGINS.md](docs/PLUGINS.md) explains how to add new tools.
