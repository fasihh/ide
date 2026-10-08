/**
 * LSP base protocol: each message is `Content-Length: <bytes>\r\n\r\n<UTF-8 JSON>`.
 * The editor side sends and receives bare JSON over the WebSocket; framing happens only here.
 */

const HEADER_END = "\r\n\r\n";

/** Splits a byte stream from a language server into message bodies. */
export class LspFrameParser {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly onMessage: (body: string) => void) {}

  push(chunk: Buffer) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END);
      if (headerEnd < 0) return;
      const start = headerEnd + HEADER_END.length;
      const length = contentLength(this.buffer.subarray(0, headerEnd).toString("ascii"));
      if (length === null) {
        // Not a header we understand (e.g. a stray log line); resynchronise after it.
        this.buffer = this.buffer.subarray(start);
        continue;
      }
      if (this.buffer.length < start + length) return;
      this.onMessage(this.buffer.subarray(start, start + length).toString("utf8"));
      this.buffer = this.buffer.subarray(start + length);
    }
  }
}

function contentLength(header: string): number | null {
  const match = /^content-length:\s*(\d+)\s*$/im.exec(header);
  return match ? Number(match[1]) : null;
}

/** Frame one JSON message for a language server's stdin. */
export function frame(body: string): Buffer {
  const bytes = Buffer.from(body, "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}${HEADER_END}`, "ascii"), bytes]);
}
