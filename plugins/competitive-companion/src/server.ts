import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { DisposableStore, type ServerPluginContext, defineServerPlugin } from "@cp-ide/plugin-api/server";
import { BatchCollector, importProblem } from "./importer.ts";
import type { CompanionMessage, ImportResult } from "./messages.ts";
import { companionPayloadSchema } from "./payload.ts";
import { CompanionReceiver } from "./receiver.ts";
import { companionSettings } from "./settings.ts";

type Activation = { receiver: CompanionReceiver; batches: BatchCollector<ImportResult> };

/** One activation's state, shared by `routes` and `setup` (the host passes both the same context). */
const activations = new WeakMap<ServerPluginContext, Activation>();

function activationFor(ctx: ServerPluginContext): Activation {
  let activation = activations.get(ctx);
  if (!activation) {
    const send = (message: CompanionMessage) => ctx.broadcast(message);
    const batches = new BatchCollector<ImportResult>((problems) => send({ kind: "imported", problems }));
    // Imports run one at a time, so a contest's problems cannot race on the same folder or URL.
    let queue = Promise.resolve();
    const receiver = new CompanionReceiver(
      (body) => {
        queue = queue
          .then(async () => {
            const payload = companionPayloadSchema.parse(body);
            const language = ctx.settings.get("problems.defaultLanguage");
            const result = await importProblem(ctx.problems, payload, language);
            ctx.log(`${result.created ? "imported" : "updated"} ${result.id} (${result.addedTests} tests)`);
            batches.add(payload.batch?.id ?? randomUUID(), payload.batch?.size ?? 1, result);
          })
          .catch((err) => send({ kind: "error", message: String((err as Error)?.message ?? err) }));
      },
      (status) => send({ kind: "status", status }),
    );
    activation = { receiver, batches };
    activations.set(ctx, activation);
  }
  return activation;
}

const plugin = defineServerPlugin({
  id: "competitive-companion",
  name: "Competitive Companion",
  description: "Import problems and sample tests from the Competitive Companion browser extension.",
  settings: companionSettings,
  routes: (ctx) => new Hono().get("/status", (c) => c.json(activationFor(ctx).receiver.status)),
  setup(ctx) {
    const { receiver, batches } = activationFor(ctx);
    const port = () => Number(ctx.settings.getRaw("competitive-companion.port"));
    void receiver.listen(port());
    const disposables = new DisposableStore();
    disposables.add(receiver);
    disposables.add(batches);
    disposables.add(
      ctx.on("settings:changed", ({ changed }) => {
        if ("competitive-companion.port" in changed) void receiver.listen(port());
      }),
    );
    return disposables;
  },
});

export default plugin;
