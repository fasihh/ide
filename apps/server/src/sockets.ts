import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import type { PluginSocket } from "@cp-ide/plugin-api/server";
import { toDisposable } from "@cp-ide/plugin-api/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Only pages served from this machine may open sockets. Browsers don't apply CORS to WebSockets,
 * so without this any website could connect to localhost and run programs.
 */
function allowedOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (tests, curl)
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function wrap(ws: WebSocket): PluginSocket {
  return {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: () => ws.close(),
    onMessage: (cb) => ws.on("message", (raw) => cb(raw.toString())),
    onClose: (cb) => ws.on("close", cb),
  };
}

/** Routes WebSocket upgrades on the HTTP server to handlers registered by path. */
export class SocketRouter {
  private wss = new WebSocketServer({ noServer: true });
  private routes = new Map<string, (socket: PluginSocket) => void>();

  add(path: string, handler: (socket: PluginSocket) => void) {
    this.routes.set(path, handler);
    return toDisposable(() => {
      if (this.routes.get(path) === handler) this.routes.delete(path);
    });
  }

  attach(server: Server) {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const handler = this.routes.get(path);
      if (!handler || !allowedOrigin(req)) {
        socket.write(`HTTP/1.1 ${handler ? "403 Forbidden" : "404 Not Found"}\r\n\r\n`);
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => handler(wrap(ws)));
    });
  }
}
