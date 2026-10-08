import { spawn } from "node:child_process";
import type { LanguageServerLaunch, PluginSocket } from "@cp-ide/plugin-api/server";
import { LspFrameParser, frame } from "./framing.ts";

/** How long a server gets to exit after its stdin closes before it is killed. */
const EXIT_GRACE_MS = 2000;
const STDERR_TAIL = 4096;

/**
 * One editor connection bridged to one language server process. Messages from the socket are
 * buffered until the launch is resolved, so the editor may send `initialize` immediately.
 * Ends (and calls `onEnd`) when either side closes.
 */
export class LanguageServerSession {
  private pending: string[] = [];
  private write: ((message: string) => void) | null = null;
  private stopProcess: (() => void) | null = null;
  private ended = false;
  private endListeners: (() => void)[] = [];

  constructor(
    private readonly socket: PluginSocket,
    private readonly log: (...args: unknown[]) => void,
  ) {
    socket.onMessage((message) => (this.write ? this.write(message) : this.pending.push(message)));
    socket.onClose(() => this.end());
  }

  /** Start the process; `null` (server unknown or unavailable) closes the connection. */
  start(launch: LanguageServerLaunch | null, cwd: string) {
    if (this.ended) return;
    if (!launch) return this.end();
    const child = spawn(launch.command, launch.args, { cwd, env: { ...process.env, ...launch.env }, windowsHide: true });
    let stderr = "";
    const parser = new LspFrameParser((body) => this.socket.send(body));
    child.stdout.on("data", (chunk: Buffer) => parser.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL)));
    child.stdin.on("error", () => {}); // the server may exit while we write
    child.on("error", (err) => {
      this.log(`could not start ${launch.command}: ${err.message}`);
      this.end();
    });
    child.on("exit", (code, signal) => {
      if (!this.ended && code !== 0) this.log(`${launch.command} exited (${signal ?? code})\n${stderr.trim()}`);
      this.end();
    });

    this.write = (message) => child.stdin.write(frame(message));
    for (const message of this.pending) this.write(message);
    this.pending = [];
    this.stopProcess = () => {
      child.stdin.end();
      setTimeout(() => child.kill(), EXIT_GRACE_MS).unref();
    };
  }

  onEnd(cb: () => void) {
    this.endListeners.push(cb);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    this.stopProcess?.();
    this.socket.close();
    for (const cb of this.endListeners) cb();
  }
}
