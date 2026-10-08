import type { Transport } from "./jsonrpc.ts";

/** Open a WebSocket and adapt it to a `Transport` once connected. */
export function connectWebSocket(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onerror = () => reject(new Error(`Could not connect to ${url}`));
    ws.onopen = () => {
      ws.onerror = null;
      resolve({
        send: (text) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(text);
        },
        onMessage: (cb) => ws.addEventListener("message", (e) => cb(String(e.data))),
        onClose: (cb) => ws.addEventListener("close", () => cb()),
        close: () => ws.close(),
      });
    };
  });
}
