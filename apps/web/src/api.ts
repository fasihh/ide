import { hc } from "hono/client";
import type { AppType } from "@cp-ide/server";

/** Typed client for the core API — route and payload types come straight from the server. */
export const api = hc<AppType>(`${location.origin}/api`);

/**
 * JSON body type of the non-error responses in a client response union. Responses with an
 * explicit error status (e.g. the validator's 400) have `ok: false` and are dropped.
 */
type SuccessJson<R> = R extends { ok: false } ? never : R extends { json(): Promise<infer T> } ? T : never;

/** Await a client call, throwing the server's `{ error }` message on non-2xx responses. */
export async function unwrap<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(
  request: Promise<R>,
): Promise<SuccessJson<R>> {
  const res = await request;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as SuccessJson<R>;
}
