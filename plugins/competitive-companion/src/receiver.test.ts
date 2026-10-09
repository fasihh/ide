import { test } from "node:test";
import assert from "node:assert/strict";
import { CompanionReceiver } from "./receiver.ts";

async function post(port: number, body: string, origin?: string) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body,
  });
  return res.status;
}

test("accepts problems from the extension and refuses web pages", async () => {
  const received: unknown[] = [];
  const statuses: string[] = [];
  const receiver = new CompanionReceiver((b) => received.push(b), (s) => statuses.push(s.state));
  const status = await receiver.listen(0);
  assert.equal(status.state, "listening");
  const port = status.state === "listening" ? status.port : 0;

  assert.equal(await post(port, '{"name":"A"}'), 200);
  assert.equal(await post(port, '{"name":"B"}', "chrome-extension://cjnmckjndlpiamhfimnnjmnckgghkjbl"), 200);
  assert.equal(await post(port, '{"name":"C"}', "moz-extension://8d6f5b1c-1111-2222-3333-444455556666"), 200);
  assert.equal(await post(port, '{"name":"evil"}', "https://evil.example"), 403);
  assert.equal(await post(port, "not json"), 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 405);
  assert.deepEqual(received, [{ name: "A" }, { name: "B" }, { name: "C" }]);

  // A second receiver cannot take the same port; it reports why instead of throwing.
  const other = new CompanionReceiver(() => {});
  const taken = await other.listen(port);
  assert.equal(taken.state, "error");
  assert.match(taken.state === "error" ? taken.error : "", /already in use/);

  receiver.dispose();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(statuses, ["listening", "stopped"]);
  await assert.rejects(post(port, "{}"), "nothing listens after dispose");
});
