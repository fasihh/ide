import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LanguageServerContribution, PluginSocket } from "@cp-ide/plugin-api/server";
import { LspFrameParser, frame } from "./framing.ts";
import { LanguageServerHost } from "./host.ts";

describe("LSP framing", () => {
  test("parses split, joined and multi-byte frames", () => {
    const got: string[] = [];
    const parser = new LspFrameParser((body) => got.push(body));
    const a = frame('{"a":"é"}');
    const b = frame('{"b":2}');
    const all = Buffer.concat([a, b]);
    parser.push(all.subarray(0, 5));
    parser.push(all.subarray(5, a.length + 3));
    parser.push(all.subarray(a.length + 3));
    assert.deepEqual(got, ['{"a":"é"}', '{"b":2}']);
  });

  test("skips headers it does not understand", () => {
    const got: string[] = [];
    const parser = new LspFrameParser((body) => got.push(body));
    parser.push(Buffer.concat([Buffer.from("garbage\r\n\r\n"), frame("{}")]));
    assert.deepEqual(got, ["{}"]);
  });
});

/** A language server that answers every request with the method name, over real stdio framing. */
const FAKE_SERVER = `
let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const end = buf.indexOf("\\r\\n\\r\\n");
    if (end < 0) return;
    const len = Number(/Content-Length: (\\d+)/i.exec(buf.subarray(0, end).toString())[1]);
    if (buf.length < end + 4 + len) return;
    const msg = JSON.parse(buf.subarray(end + 4, end + 4 + len).toString());
    buf = buf.subarray(end + 4 + len);
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { method: msg.method, env: process.env.FAKE_LSP } }));
    process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
    process.stdout.write(body);
  }
});
`;

function fakeSocket() {
  const sent: string[] = [];
  const handlers = { message: [] as ((m: string) => void)[], close: [] as (() => void)[] };
  let closed = false;
  const socket: PluginSocket = {
    send: (data) => sent.push(data),
    close: () => {
      if (closed) return;
      closed = true;
      for (const h of handlers.close) h();
    },
    onMessage: (cb) => void handlers.message.push(cb),
    onClose: (cb) => void handlers.close.push(cb),
  };
  return {
    socket,
    sent,
    isClosed: () => closed,
    receive: (m: string) => handlers.message.forEach((h) => h(m)),
    waitFor: async (n: number) => {
      for (let i = 0; i < 200 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(sent.length >= n, `expected ${n} messages, got ${sent.length}`);
    },
    waitClosed: async () => {
      for (let i = 0; i < 200 && !closed; i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(closed, "socket closed");
    },
  };
}

describe("LanguageServerHost", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cp-ide-lsp-test-"));
  const script = path.join(dir, "fake-lsp.cjs");
  await fs.writeFile(script, FAKE_SERVER);
  const fake: LanguageServerContribution = {
    id: "fake",
    name: "Fake",
    languages: ["cpp"],
    restartOn: ["fake.flag"],
    resolve: async () => ({ ok: true, launch: { command: process.execPath, args: [script], env: { FAKE_LSP: "yes" }, initializationOptions: { x: 1 } } }),
  };

  test("bridges messages sent before the process is up, and lists servers", async () => {
    const host = new LanguageServerHost(() => dir, () => {});
    const registration = host.register(fake);
    host.register({ id: "missing", name: "Missing", languages: ["python"], resolve: async () => ({ ok: false, error: "not installed", hint: "install it" }) });
    assert.deepEqual(await host.list(), [
      { id: "fake", name: "Fake", languages: ["cpp"], available: true, initializationOptions: { x: 1 }, configuration: undefined },
      { id: "missing", name: "Missing", languages: ["python"], available: false, error: "not installed", hint: "install it", action: undefined },
    ]);

    const s = fakeSocket();
    host.connect("fake", s.socket);
    s.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    await s.waitFor(1);
    assert.deepEqual(JSON.parse(s.sent[0]!), { jsonrpc: "2.0", id: 1, result: { method: "initialize", env: "yes" } });

    host.settingsChanged(["unrelated"]);
    assert.equal(s.isClosed(), false);
    host.settingsChanged(["fake.flag"]);
    assert.equal(s.isClosed(), true, "restartOn settings end the session");

    registration.dispose();
    const after = fakeSocket();
    host.connect("fake", after.socket);
    await after.waitClosed();
  });

  test("unavailable or unknown servers close the connection", async () => {
    const host = new LanguageServerHost(() => dir, () => {});
    host.register({ id: "missing", name: "Missing", languages: ["python"], resolve: async () => ({ ok: false, error: "nope" }) });
    for (const id of ["missing", "unknown", null]) {
      const s = fakeSocket();
      host.connect(id, s.socket);
      await s.waitClosed();
    }
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });
});
