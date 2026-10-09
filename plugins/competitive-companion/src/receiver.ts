import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Disposable } from "@cp-ide/plugin-api/server";
import type { ReceiverStatus } from "./messages.ts";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * Requests from the extension carry an extension origin (or none, e.g. curl). A web page's origin is
 * refused, so a site you visit cannot create problems by POSTing to this port.
 */
const allowedOrigin = (origin: string | undefined) => !origin || /^(chrome|moz|safari-web)-extension:\/\//.test(origin);

/** The local HTTP endpoint Competitive Companion posts problems to (one JSON body per problem). */
export class CompanionReceiver implements Disposable {
  private server: http.Server | null = null;
  private current: ReceiverStatus = { state: "stopped" };

  constructor(
    private readonly onPayload: (body: unknown) => void,
    private readonly onStatus: (status: ReceiverStatus) => void = () => {},
  ) {}

  get status(): ReceiverStatus {
    return this.current;
  }

  /** (Re)start on `port`; resolves once listening or failed (e.g. the port is taken). */
  async listen(port: number): Promise<ReceiverStatus> {
    await this.close();
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    const status = await new Promise<ReceiverStatus>((resolve) => {
      server.once("error", (err: NodeJS.ErrnoException) =>
        resolve({ state: "error", port, error: err.code === "EADDRINUSE" ? `Port ${port} is already in use (by another tool or a second cp-ide)` : err.message }),
      );
      // Report the bound port (differs from `port` only when it is 0, i.e. "any free port").
      server.listen(port, "127.0.0.1", () => resolve({ state: "listening", port: (server.address() as AddressInfo).port }));
    });
    if (this.server !== server) return this.current; // closed or restarted meanwhile
    if (status.state === "error") this.server = null;
    this.setStatus(status);
    return status;
  }

  dispose() {
    void this.close();
  }

  private async close() {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.setStatus({ state: "stopped" });
  }

  private setStatus(status: ReceiverStatus) {
    this.current = status;
    this.onStatus(status);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!allowedOrigin(req.headers.origin)) return void res.writeHead(403).end();
    if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return void res.writeHead(400).end("Invalid JSON");
      }
      // Answer at once; the extension does not wait for (or show) the result.
      res.writeHead(200).end();
      this.onPayload(body);
    });
  }
}
