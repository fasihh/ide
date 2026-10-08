import { test } from "node:test";
import assert from "node:assert/strict";
import { LanguageClient } from "./client.ts";
import { ErrorCodes, JsonRpcConnection, ResponseError, type Transport } from "./jsonrpc.ts";

/** Two connected in-memory transports (delivery is async, like a socket). */
function transportPair(): [Transport, Transport] {
  const make = () => ({ message: [] as ((t: string) => void)[], close: [] as (() => void)[] });
  const a = make();
  const b = make();
  let open = true;
  const side = (self: typeof a, other: typeof a): Transport => ({
    send: (text) => void (open && queueMicrotask(() => other.message.forEach((cb) => cb(text)))),
    onMessage: (cb) => void self.message.push(cb),
    onClose: (cb) => void self.close.push(cb),
    close: () => {
      if (!open) return;
      open = false;
      [...a.close, ...b.close].forEach((cb) => cb());
    },
  });
  return [side(a, b), side(b, a)];
}

test("requests, notifications and server-to-client requests", async () => {
  const [clientSide, serverSide] = transportPair();
  const client = new JsonRpcConnection(clientSide);
  const server = new JsonRpcConnection(serverSide);
  server.onRequest<{ n: number }>("double", ({ n }) => n * 2);
  const seen: unknown[] = [];
  server.onNotification("note", (p) => seen.push(p));

  assert.equal(await client.request("double", { n: 21 }), 42);
  client.notify("note", { hi: 1 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(seen, [{ hi: 1 }]);
  await assert.rejects(client.request("nope"), (e: ResponseError) => e.code === ErrorCodes.MethodNotFound);
});

test("abort sends $/cancelRequest; closing rejects pending requests", async () => {
  const [clientSide, serverSide] = transportPair();
  const client = new JsonRpcConnection(clientSide);
  const server = new JsonRpcConnection(serverSide);
  const cancelled: unknown[] = [];
  server.onRequest("slow", () => new Promise(() => {}));
  server.onNotification("$/cancelRequest", (p) => cancelled.push(p));

  const controller = new AbortController();
  const slow = client.request("slow", undefined, controller.signal);
  controller.abort();
  await assert.rejects(slow, (e: ResponseError) => e.code === ErrorCodes.RequestCancelled);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(cancelled, [{ id: 1 }]);

  const pending = client.request("slow");
  client.dispose();
  await assert.rejects(pending, /Connection closed/);
  assert.equal(server.isClosed, true);
});

test("LanguageClient handshake, versioned full sync and diagnostics", async () => {
  const [clientSide, serverSide] = transportPair();
  const server = new JsonRpcConnection(serverSide);
  const log: [string, any][] = [];
  server.onRequest("initialize", (p: any) => {
    log.push(["initialize", p]);
    return { capabilities: { hoverProvider: true } };
  });
  for (const m of ["initialized", "textDocument/didOpen", "textDocument/didChange", "textDocument/didClose"]) server.onNotification(m, (p) => log.push([m, p]));

  const client = new LanguageClient(new JsonRpcConnection(clientSide), {
    clientName: "test",
    rootUri: "file:///root",
    initializationOptions: { a: 1 },
    configuration: { python: { pythonPath: "py" } },
  });
  const diagnostics: unknown[] = [];
  client.onDiagnostics((uri, d) => diagnostics.push([uri, d.length]));
  await client.start();
  assert.equal(client.capabilities.hoverProvider, true);

  client.open("file:///root/a.cpp", "cpp", "int x;");
  client.change("file:///root/a.cpp", "int y;");
  client.close("file:///root/a.cpp");
  client.close("file:///root/a.cpp"); // already closed: no second notification
  server.notify("textDocument/publishDiagnostics", { uri: "file:///root/a.cpp", diagnostics: [{}] });
  // Configuration is answered per section; unknown sections get null.
  assert.deepEqual(await server.request("workspace/configuration", { items: [{ section: "python" }, { section: "other" }, {}] }), [{ pythonPath: "py" }, null, null]);

  assert.equal(log[0]![1].initializationOptions.a, 1);
  assert.deepEqual(log[0]![1].workspaceFolders, [{ uri: "file:///root", name: "workspace" }]);
  assert.deepEqual(
    log.slice(1).map(([m, p]) => [m, p.textDocument?.version]),
    [["initialized", undefined], ["textDocument/didOpen", 1], ["textDocument/didChange", 2], ["textDocument/didClose", undefined]],
  );
  assert.deepEqual(diagnostics, [["file:///root/a.cpp", 1]]);
});
