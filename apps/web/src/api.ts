import { hc } from "hono/client";
import type { AppType } from "@cp-ide/server";

export { unwrap } from "@cp-ide/plugin-api/web";

/** Typed client for the core API — route and payload types come straight from the server. */
export const api = hc<AppType>(`${location.origin}/api`);
