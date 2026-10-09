import type { ServerEvent } from "@cp-ide/shared";
import { Emitter } from "@cp-ide/plugin-api/web";
import { events } from "./registry.ts";

/** Messages from server plugins to their web halves (`ctx.serverEvents`). */
export const pluginMessages = new Emitter<{ message: { pluginId: string; payload: unknown } }>();
import { reconcileFromDisk, refreshProblemsQuietly, useWorkspace } from "./workspace.ts";

/** The server pings every 20s; without one for this long the connection is considered dead. */
const STALE_MS = 45_000;

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

function handleChange(ids: string[]) {
  events.emit("problems:changed", { ids });
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshProblemsQuietly().catch(() => {}), 200);
  void reconcileFromDisk(ids);
}

/**
 * Subscribe to `/api/events` (SSE). File changes under the problems root — from the app itself or
 * from another program — refresh the problem list and the open problem.
 *
 * EventSource reconnects by itself when the socket closes, but a proxy (Vite in dev) can leave a
 * dead connection hanging after a server restart, so a watchdog recreates it when pings stop.
 * After any reconnect we resync, since changes may have been missed meanwhile.
 */
export function installServerEvents({ onPluginsChanged }: { onPluginsChanged: () => void }) {
  let source: EventSource | null = null;
  let lastSeen = Date.now();
  let opened = false;

  const connect = () => {
    source?.close();
    source = new EventSource(`${location.origin}/api/events`);
    source.onopen = () => {
      lastSeen = Date.now();
      if (opened) {
        const open = useWorkspace.getState().problem?.id;
        handleChange(open ? [open] : []);
      }
      opened = true;
    };
    source.addEventListener("ping", () => (lastSeen = Date.now()));
    source.onmessage = (msg) => {
      lastSeen = Date.now();
      let event: ServerEvent;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (event.type === "problems-changed") handleChange(event.ids);
      else if (event.type === "plugins-changed") onPluginsChanged();
      else if (event.type === "plugin") pluginMessages.emit("message", { pluginId: event.pluginId, payload: event.payload });
    };
  };

  connect();
  const watchdog = setInterval(() => {
    if (Date.now() - lastSeen > STALE_MS) {
      lastSeen = Date.now();
      connect();
    }
  }, 10_000);
  return () => {
    clearInterval(watchdog);
    source?.close();
  };
}
