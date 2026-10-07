import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Eraser, Loader2, Square } from "lucide-react";
import type { PanelProps } from "@cp-ide/plugin-api/web";
import { cssVarHex } from "@cp-ide/editor";
import { Button, Tooltip, cn } from "@cp-ide/ui";
import { ansi, attachTerminal, isRunning, sendEof, sendStdin, stopRun, termClear, termWrite, usePlayground } from "./store.ts";

function terminalTheme(dark: boolean) {
  return {
    background: cssVarHex("--panel", dark ? "#18181b" : "#ffffff"),
    foreground: cssVarHex("--foreground", dark ? "#e4e4e7" : "#18181b"),
    cursor: cssVarHex("--primary", "#3b82f6"),
    selectionBackground: `${cssVarHex("--primary", "#3b82f6")}55`,
    red: cssVarHex("--verdict-wa", "#ef4444"),
    green: cssVarHex("--verdict-ac", "#22c55e"),
  };
}

/**
 * Line discipline for a pipe-backed program: echo what the user types, edit with Backspace, send the
 * line on Enter. Ctrl+C stops the program (or copies a selection), Ctrl+D sends end-of-input.
 */
function attachInput(term: Terminal) {
  let line = "";
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection());
      return false;
    }
    return true;
  });
  return term.onData((data) => {
    if (!isRunning()) {
      if (data === "\r") termWrite(ansi.dim("Not running — press Run (Ctrl+Enter) first.\r\n"));
      return;
    }
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        term.write("\r\n");
        sendStdin(`${line}\n`);
        line = "";
      } else if (ch === "\x7f" || ch === "\b") {
        if (line) {
          line = [...line].slice(0, -1).join("");
          term.write("\b \b");
        }
      } else if (ch === "\x03") {
        term.write("^C\r\n");
        line = "";
        stopRun();
      } else if (ch === "\x04") {
        if (line) sendStdin(line);
        line = "";
        sendEof();
        term.write(ansi.dim("^D\r\n"));
      } else if (ch >= " " || ch === "\t") {
        line += ch;
        term.write(ch);
      }
    }
  });
}

function Status() {
  const run = usePlayground((s) => s.run);
  const [, tick] = useState(0);
  useEffect(() => {
    if (run.phase !== "running") return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [run.phase]);
  switch (run.phase) {
    case "idle":
      return <span className="text-muted-foreground">Ready — Run from the Playground (Ctrl+Enter)</span>;
    case "compiling":
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Compiling {run.file}…
        </span>
      );
    case "running":
      return (
        <span className="flex items-center gap-1.5 text-verdict-ac">
          <span className="size-1.5 animate-pulse rounded-full bg-verdict-ac" /> Running {run.file} · {((Date.now() - run.since) / 1000).toFixed(1)} s · type input and press Enter
        </span>
      );
    case "compile-error":
      return <span className="text-verdict-wa">Compilation failed</span>;
    case "exited":
      return (
        <span className={cn(run.exitCode === 0 && !run.message ? "text-muted-foreground" : "text-verdict-wa")}>
          Exited with code {run.exitCode ?? "–"} · {run.timeMs} ms{run.message ? ` · ${run.message}` : ""}
        </span>
      );
  }
}

export function TerminalPanel({ ctx }: PanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const theme = ctx.theme.use();
  const fontFamily = ctx.settings.use("editor.fontFamily");
  const fontSize = ctx.settings.use("editor.fontSize");
  const running = usePlayground((s) => s.run.phase === "running" || s.run.phase === "compiling");

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ convertEol: true, cursorBlink: true, scrollback: 5000, fontFamily, fontSize: Math.max(10, fontSize - 1), theme: terminalTheme(theme === "dark") });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    termRef.current = term;
    const input = attachInput(term);
    attachTerminal({ write: (t) => term.write(t), clear: () => term.clear() });
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {}
    });
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      input.dispose();
      attachTerminal(null);
      term.dispose();
      termRef.current = null;
    };
    // Recreated only on mount; options are updated below.
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalTheme(theme === "dark");
    term.options.fontFamily = fontFamily;
    term.options.fontSize = Math.max(10, fontSize - 1);
  }, [theme, fontFamily, fontSize]);

  return (
    <div data-playground-root className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-2 text-[0.6875rem]">
        <div className="min-w-0 flex-1 truncate">
          <Status />
        </div>
        <Tooltip content="Clear">
          <Button variant="ghost" size="icon-sm" onClick={termClear}>
            <Eraser />
          </Button>
        </Tooltip>
        <Tooltip content="Stop (Ctrl+C in the terminal)">
          <Button variant="ghost" size="icon-sm" disabled={!running} onClick={stopRun}>
            <Square className="fill-current" />
          </Button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 px-2 pt-1" onClick={() => termRef.current?.focus()}>
        <div ref={host} className="h-full" />
      </div>
    </div>
  );
}

export function focusTerminal() {
  document.querySelector<HTMLTextAreaElement>("[data-playground-root] .xterm-helper-textarea")?.focus();
}
